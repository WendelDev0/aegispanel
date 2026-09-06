import type { WaFlowNode, WaFlowRecord, WaPanelEvent } from '../db/storage.js';
import { dbStorage } from '../db/storage.js';
import {
  classifyEvolutionInbound,
  evolutionSendButtons,
  evolutionSendMedia,
  evolutionSendText,
  type InboundWaMessage,
  type EvolutionCredentials,
} from '../utils/evolution.client.js';
import { phoneHash, phoneTail } from '../utils/phone.js';
import { WaSessionStore } from '../utils/wa-session.store.js';
import { WaLogStore } from '../utils/wa-log.store.js';
import { WaInboundStore } from '../utils/wa-inbound.store.js';
import { isDuplicateMessage } from '../utils/wa-dedupe.js';
import { runSerial } from '../utils/serial-queue.js';
import { liveFlowGateways } from './wa-flow-gateways.js';
import { HandoffManager } from './wa-flow-handoff.js';
import { NODE_HANDLERS } from './wa-flow-handlers.js';
import {
  applyVars,
  flowBoundToInstance,
  matchesTrigger,
  nodeById,
  outgoing,
  pickMenuHandle,
  sessionAt,
  validateCaptureValue,
} from './wa-flow-graph.js';
import { deliverButtons, deliverText } from './wa-flow-io.js';
import { WaFlowService } from './wa-flow.service.js';
import type {
  EvolutionSender,
  FlowContext,
  FlowPorts,
  WaSession,
} from './wa-flow-ports.js';

export type { FlowContext };
export { HandoffManager };
export { applyVars };

/** A flow cannot walk forever; a cycle without a waiting node would spin. */
const MAX_STEPS = 40;

const defaultSender: EvolutionSender = {
  sendText: evolutionSendText,
  sendButtons: evolutionSendButtons,
  sendMedia: evolutionSendMedia,
};

/**
 * The agent, http, sql, media and contact gateways belong here, not only in
 * the simulator. Leaving them out made `ports.ai` undefined in production, so
 * an AI block took its error branch without a word while the same flow
 * answered fine in the preview — the simulator was the only place those
 * blocks ever ran.
 */
const defaultPorts: FlowPorts = {
  sender: defaultSender,
  sessions: new WaSessionStore(),
  logs: new WaLogStore(),
  contacts: liveFlowGateways.contacts,
  ai: liveFlowGateways.ai,
  http: liveFlowGateways.http,
  sql: liveFlowGateways.sql,
  media: liveFlowGateways.media,
};

/**
 * Walks the graph from one node until it waits, ends or runs out of steps.
 *
 * Every block is a handler in `NODE_HANDLERS` that returns where to go next;
 * this loop only knows how to follow that answer, so a new block never needs
 * this function edited.
 */
async function runFrom(
  flow: WaFlowRecord,
  startId: string,
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  ports: FlowPorts
): Promise<WaSession | null> {
  let current = nodeById(flow, startId);

  while (current && ctx.stepsCount < MAX_STEPS) {
    ctx.stepsCount += 1;

    const handler = NODE_HANDLERS[current.type];
    const result = handler ? await handler({ flow, node: current, ctx, creds, ports }) : { kind: 'goto' as const };

    if (result.kind === 'stop') return null;
    if (result.kind === 'wait') return sessionAt(flow, current, ctx);

    if (result.kind === 'jump') {
      current = nodeById(flow, result.nodeId);
      continue;
    }

    const next = outgoing(flow, current.id, result.handle);
    current = next ? nodeById(flow, next.target) : undefined;
  }

  return null;
}

/**
 * Turns an attachment into the text the rest of the flow already understands.
 *
 * A voice note used to reach `no_text` and die there: two ticks, no answer,
 * and the inbound strip said "mensagem sem texto" as if the customer had sent
 * a sticker. Every block downstream works on `ctx.text`, so transcribing at
 * the door is all that a flow needs to handle audio — no new blocks, no
 * branch in the editor.
 */
async function resolveMedia(
  inbound: InboundWaMessage,
  ctx: FlowContext,
  flow: WaFlowRecord | undefined,
  creds: EvolutionCredentials | null,
  ports: FlowPorts,
  raw: unknown
): Promise<{ text: string; error?: string }> {
  const media = inbound.media;
  if (!media) return { text: inbound.text };

  ctx.vars.midia_tipo = media.kind;
  if (media.mimetype) ctx.vars.midia_mimetype = media.mimetype;
  if (media.fileName) ctx.vars.midia_arquivo = media.fileName;
  if (media.kind === 'location') {
    ctx.vars.midia_latitude = String(media.latitude ?? '');
    ctx.vars.midia_longitude = String(media.longitude ?? '');
  }

  // A caption is the customer's own words; never override it.
  if (inbound.text) return { text: inbound.text };

  const placeholder =
    media.kind === 'document'
      ? `[documento${media.fileName ? `: ${media.fileName}` : ''}]`
      : media.kind === 'location'
        ? '[localização]'
        : `[${media.kind === 'image' ? 'imagem' : media.kind === 'video' ? 'vídeo' : 'áudio'}]`;

  if (media.kind !== 'audio') return { text: placeholder };
  if (flow && flow.transcribeAudio === false) return { text: placeholder };
  if (!ports.ai?.transcribe) return { text: placeholder, error: 'Transcrição indisponível: sem provedor de IA.' };

  // Long recordings are billed by the minute and rarely a flow answer; the
  // placeholder still lets a condition route them to a human.
  if (media.seconds && media.seconds > 300) {
    return { text: placeholder, error: 'Áudio acima de 5 minutos não é transcrito.' };
  }

  try {
    let base64 = media.base64;
    if (!base64) {
      if (!ports.media) throw new Error('Gateway de mídia indisponível.');
      const fetched = await ports.media.fetchBase64(creds ?? { apiUrl: '', apiKey: '', instance: ctx.instance }, {
        messageId: inbound.messageId,
        raw,
      });
      base64 = fetched.base64;
    }
    const text = await ports.ai.transcribe({ base64, mimetype: media.mimetype });
    ctx.vars.midia_transcricao = text.slice(0, 2000);
    return { text: text.slice(0, 2000) };
  } catch (err: any) {
    return { text: placeholder, error: String(err?.message || err).slice(0, 300) };
  }
}

export class WaFlowEngine {
  static async handleInbound(
    body: unknown,
    customSender?: EvolutionSender,
    customPorts?: Partial<FlowPorts>
  ): Promise<boolean> {
    const classified = classifyEvolutionInbound(body);

    if (classified.kind === 'skipped') {
      const reason = classified.reason;
      // Groups, status broadcasts, channels and the operator's own outgoing
      // messages are not flow traffic. Counting them keeps the strip readable
      // while still proving the webhook is alive.
      if (reason === 'group' || reason === 'broadcast' || reason === 'newsletter' || reason === 'from_me') {
        WaInboundStore.countSkipped(reason);
        return false;
      }
      WaInboundStore.record({
        outcome: reason === 'no_text' ? 'no_text' : 'parse_failed',
        instance: classified.instance,
        phoneTail: classified.phone ? phoneTail(classified.phone) : undefined,
        error:
          reason === 'no_text'
            ? 'Mensagem sem texto (figurinha ou mídia que o painel não interpreta). Fluxos reagem a texto, áudio, imagem, documento e localização.'
            : undefined,
      });
      return false;
    }

    const inbound = classified.message;

    const fallbackCreds = WaFlowService.evolutionCreds();
    const instance = inbound.instance || fallbackCreds?.instance || '';
    if (!instance) {
      console.warn('⚠️ Inbound do WhatsApp recebido sem identificação de instância.');
      WaInboundStore.record({
        outcome: 'no_instance',
        phoneTail: phoneTail(inbound.phone),
        textExcerpt: inbound.text,
      });
      return false;
    }

    // A retry carries the same key.id. Replaying it would send the greeting
    // twice and let a `capture` node eat the answer to a question it already
    // moved past. True, not false: the message was handled the first time.
    if (isDuplicateMessage(instance, inbound.messageId)) {
      WaInboundStore.countSkipped('duplicate');
      return true;
    }

    // One turn at a time per contact. Two messages arriving together read the
    // same session row and the slower write wins, so the customer sees the
    // same question twice.
    return runSerial(`${instance}__${phoneHash(inbound.phone)}`, () =>
      this.runConversation(inbound, instance, body, customSender, customPorts)
    );
  }

  private static async runConversation(
    inbound: InboundWaMessage,
    instance: string,
    raw: unknown,
    customSender?: EvolutionSender,
    customPorts?: Partial<FlowPorts>
  ): Promise<boolean> {
    // Reply from the instance that received the message, not Settings' leftover name.
    const creds = WaFlowService.evolutionCreds(instance);

    const ports: FlowPorts = {
      ...defaultPorts,
      ...customPorts,
      sender: customSender || customPorts?.sender || defaultPorts.sender,
    };

    const pHash = phoneHash(inbound.phone);
    const pTail = phoneTail(inbound.phone);

    // 1. A human is already on this conversation.
    if (HandoffManager.isActive(instance, pHash)) {
      await ports.logs.appendTurn({
        at: new Date().toISOString(),
        instance,
        flowId: 'handoff',
        phoneHash: pHash,
        phoneTail: pTail,
        direction: 'in',
        textExcerpt: `[Handoff Humano Ativo] ${inbound.text.slice(0, 200)}`,
      });
      WaInboundStore.record({
        outcome: 'handoff',
        instance,
        phoneTail: pTail,
        textExcerpt: inbound.text,
      });
      return true; // silently absorbed
    }

    // 2. The contact behind the number, and whatever they told us before.
    const contact = ports.contacts.load(instance, inbound.phone, inbound.pushName);
    const session = await ports.sessions.read(instance, inbound.phone);
    const now = new Date();

    const vars: Record<string, string> = {
      // Contact attributes sit under session vars: a value captured in this
      // conversation is fresher than the one stored last week.
      ...(contact?.attrs || {}),
      ...(session?.vars || {}),
      nome: inbound.pushName || session?.vars?.nome || contact?.attrs?.nome || '',
      telefone_final: pTail,
      instancia: instance,
      ultima_mensagem: inbound.text,
      agora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const ctx: FlowContext = {
      instance,
      phone: inbound.phone,
      phoneHash: pHash,
      phoneTail: pTail,
      text: inbound.text,
      vars,
      stepsCount: 0,
      media: inbound.media,
      rawInbound: raw,
      contact: contact || undefined,
    };

    const sessionFlow = session?.flowId ? dbStorage.getWaFlowById(session.flowId) : undefined;
    const resolved = await resolveMedia(inbound, ctx, sessionFlow, creds, ports, raw);
    ctx.text = resolved.text;
    ctx.vars.ultima_mensagem = resolved.text;

    // An attachment the panel could not read at all is still silence to the
    // customer, so it lands on the strip instead of running an empty turn.
    if (!ctx.text) {
      WaInboundStore.record({
        outcome: 'no_text',
        instance,
        phoneTail: pTail,
        error: resolved.error || 'Mídia recebida sem conteúdo interpretável.',
      });
      return false;
    }

    ports.contacts.appendMessage(instance, pHash, 'user', ctx.text, session?.flowId);

    await ports.logs.appendTurn({
      at: now.toISOString(),
      instance,
      flowId: session?.flowId || 'unknown',
      phoneHash: pHash,
      phoneTail: pTail,
      direction: 'in',
      nodeId: session?.nodeId,
      textExcerpt: ctx.text.slice(0, 240),
      error: resolved.error,
    });

    // 3. Resume a conversation that was waiting on an answer.
    if (session?.waiting) {
      const flow = sessionFlow && sessionFlow.published ? sessionFlow : undefined;
      const waitingNode = flow ? nodeById(flow, session.nodeId) : undefined;

      if (flow && waitingNode) {
        const step = await this.resumeWaiting(flow, waitingNode, session, ctx, creds, ports);

        if (step.kind === 'reprompted') {
          WaInboundStore.record({
            outcome: ctx.sendError ? 'send_failed' : 'handled',
            instance,
            phoneTail: pTail,
            textExcerpt: ctx.text,
            flowId: flow.id,
            flowName: flow.name,
            error: ctx.sendError,
          });
          return true;
        }

        if (step.kind === 'advance') {
          await this.finishTurn(flow, step.nextId, ctx, creds, ports, inbound.phone);
          WaInboundStore.record({
            outcome: ctx.sendError ? 'send_failed' : 'handled',
            instance,
            phoneTail: pTail,
            textExcerpt: ctx.text,
            flowId: flow.id,
            flowName: flow.name,
            error: ctx.sendError,
          });
          return true;
        }
      }
      // The flow was unpublished, deleted or edited past this node while the
      // customer was mid-answer; start them over rather than stranding them.
      await ports.sessions.clear(instance, inbound.phone);
    }

    // 4. No waiting session: pick the flow whose trigger fits best.
    const flow = this.pickFlow(instance, ctx.text);
    if (!flow) {
      WaFlowService.recordUnmatched(instance);
      WaInboundStore.record({
        outcome: 'unmatched',
        instance,
        phoneTail: pTail,
        textExcerpt: ctx.text,
      });
      return false;
    }

    const trigger = flow.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, ctx.text));
    if (!trigger) return false;

    await this.finishTurn(flow, trigger.id, ctx, creds, ports, inbound.phone);
    WaInboundStore.record({
      outcome: ctx.sendError ? 'send_failed' : 'handled',
      instance,
      phoneTail: pTail,
      textExcerpt: ctx.text,
      flowId: flow.id,
      flowName: flow.name,
      error: ctx.sendError,
    });
    return true;
  }

  /**
   * What a menu or capture block does with the answer it was waiting for.
   *
   * Shared with `simulate`, which used to carry its own copy that skipped
   * retry counting and capture validation — so the preview accepted an answer
   * the live bot rejected.
   */
  private static async resumeWaiting(
    flow: WaFlowRecord,
    waitingNode: WaFlowNode,
    session: WaSession,
    ctx: FlowContext,
    creds: EvolutionCredentials | null,
    ports: FlowPorts
  ): Promise<{ kind: 'advance'; nextId: string } | { kind: 'reprompted' } | { kind: 'restart' }> {
    if (waitingNode.type === 'menu') {
      const handle = pickMenuHandle(waitingNode, ctx.text);
      if (handle) {
        const target = outgoing(flow, waitingNode.id, handle)?.target;
        return target ? { kind: 'advance', nextId: target } : { kind: 'restart' };
      }

      const attempts = (session.attempts || 0) + 1;
      if (attempts >= 2) {
        const target =
          outgoing(flow, waitingNode.id, 'fallback')?.target || outgoing(flow, waitingNode.id)?.target;
        return target ? { kind: 'advance', nextId: target } : { kind: 'restart' };
      }

      await ports.sessions.write(ctx.instance, ctx.phone, { ...session, attempts }, flow.sessionTtlMinutes);
      const body = applyVars(waitingNode.data.text || 'Opção inválida. Escolha uma das opções:', ctx.vars);
      await deliverButtons(ctx, creds, ports, ctx.phone, body, waitingNode.data.buttons || []);
      return { kind: 'reprompted' };
    }

    if (waitingNode.type === 'capture') {
      const capType = waitingNode.data.captureType || 'text';
      if (validateCaptureValue(capType, ctx.text)) {
        const varName = waitingNode.data.varName;
        if (varName) {
          const value = ctx.text.trim();
          ctx.vars[varName] = value;
          // `saveLead` was a checkbox on two shipped templates that no code
          // ever read: the value lived in the session and vanished with it.
          if (waitingNode.data.saveLead) {
            ctx.contactPatch = { ...(ctx.contactPatch || {}), [varName]: value };
            ports.contacts.saveAttrs(ctx.instance, ctx.phoneHash, { [varName]: value });
          }
        }
        const target =
          outgoing(flow, waitingNode.id, 'next')?.target || outgoing(flow, waitingNode.id)?.target;
        return target ? { kind: 'advance', nextId: target } : { kind: 'restart' };
      }

      const attempts = (session.attempts || 0) + 1;
      if (attempts >= 3) {
        const target = outgoing(flow, waitingNode.id, 'invalid')?.target;
        return target ? { kind: 'advance', nextId: target } : { kind: 'restart' };
      }

      await ports.sessions.write(ctx.instance, ctx.phone, { ...session, attempts }, flow.sessionTtlMinutes);
      await deliverText(
        ctx,
        creds,
        ports,
        ctx.phone,
        `Formato inválido para ${capType}. Por favor, envie um valor válido.`
      );
      return { kind: 'reprompted' };
    }

    const target = outgoing(flow, waitingNode.id)?.target;
    return target ? { kind: 'advance', nextId: target } : { kind: 'restart' };
  }

  /** Runs the rest of the turn and persists whatever it left behind. */
  private static async finishTurn(
    flow: WaFlowRecord,
    startId: string,
    ctx: FlowContext,
    creds: EvolutionCredentials | null,
    ports: FlowPorts,
    phone: string
  ): Promise<void> {
    const nextSession = await runFrom(flow, startId, ctx, creds, ports);
    WaFlowService.markRun(flow.id, ctx.sendError ? { error: true } : undefined);

    if (nextSession) {
      await ports.sessions.write(ctx.instance, phone, nextSession, flow.sessionTtlMinutes);
    } else {
      await ports.sessions.clear(ctx.instance, phone);
    }
  }

  /**
   * Deterministic pick among the flows whose trigger matches:
   * priority, then trigger specificity (regex > contains > any), then recency.
   */
  private static pickFlow(instance: string, text: string): WaFlowRecord | undefined {
    const candidates = dbStorage
      .getWaFlows()
      .filter(
        (f) =>
          f.published &&
          flowBoundToInstance(f, instance) &&
          f.nodes.some((n) => n.type === 'trigger_message' && matchesTrigger(n, text))
      );

    if (candidates.length === 0) return undefined;

    const score = (t?: WaFlowNode) => {
      if (!t) return 0;
      if (t.data.match === 'regex') return 3;
      if (t.data.match === 'contains') return 2;
      return 1;
    };

    candidates.sort((a, b) => {
      const pDiff = (b.priority || 0) - (a.priority || 0);
      if (pDiff !== 0) return pDiff;

      const trigA = a.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, text));
      const trigB = b.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, text));
      const sDiff = score(trigB) - score(trigA);
      if (sDiff !== 0) return sDiff;

      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

    return candidates[0];
  }

  static async handlePanelEvent(
    event: WaPanelEvent,
    vars: Record<string, string>,
    customSender?: EvolutionSender
  ): Promise<number> {
    const creds = WaFlowService.evolutionCreds();
    const globalRecipient = dbStorage.getSettings().alertConfig?.whatsappRecipientNumber;

    const flows = dbStorage
      .getWaFlows()
      .filter((f) => f.published && f.nodes.some((n) => n.type === 'trigger_event' && n.data.event === event));

    let ran = 0;
    const sender = customSender || defaultSender;

    for (const flow of flows) {
      const trigger = flow.nodes.find((n) => n.type === 'trigger_event' && n.data.event === event);
      if (!trigger) continue;

      const recipient = trigger.data.recipient || globalRecipient;
      const instance = trigger.data.instance || flow.instanceNames?.[0] || creds?.instance;
      if (!recipient || !instance) continue;

      const pHash = phoneHash(recipient);
      const pTail = phoneTail(recipient);

      const ctx: FlowContext = {
        instance,
        phone: recipient,
        phoneHash: pHash,
        phoneTail: pTail,
        text: vars.evento || event,
        vars: {
          evento: event,
          telefone_final: pTail,
          instancia: instance,
          agora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          ...vars,
        },
        stepsCount: 0,
      };

      await runFrom(flow, trigger.id, ctx, creds ? { ...creds, instance } : null, {
        ...defaultPorts,
        sender,
      });
      WaFlowService.markRun(flow.id);
      ran += 1;
    }
    return ran;
  }

  static mapBroadcast(type: 'deploy' | 'alert' | 'backup', isError: boolean): WaPanelEvent | null {
    if (type === 'deploy') return isError ? 'deploy_fail' : 'deploy_ok';
    if (type === 'backup') return 'backup';
    if (type === 'alert' && isError) return 'app_down';
    return null;
  }

  /**
   * Runs a flow in memory with fake gateways.
   *
   * The waiting-node rules come from `resumeWaiting`, the same function the
   * live path uses: the previous copy here accepted any answer a capture
   * block was given and never counted a retry, so a flow could look correct
   * in the preview and reject the customer in production.
   */
  static async simulate(
    flowId: string,
    messages: string[],
    initialVars: Record<string, string> = {}
  ): Promise<{
    turns: Array<{ role: 'user' | 'bot'; text: string; buttons?: string[]; nodeId?: string }>;
    vars: Record<string, string>;
    lastNodeId?: string;
  }> {
    const flow = WaFlowService.get(flowId);
    const turns: Array<{ role: 'user' | 'bot'; text: string; buttons?: string[]; nodeId?: string }> = [];
    let currentVars: Record<string, string> = {
      ...initialVars,
      nome: 'Visitante (Simulação)',
      telefone_final: '1234',
    };
    let memorySession: WaSession | null = null;
    let lastNodeId: string | undefined;
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const fakeAttrs: Record<string, string> = {};

    const mockSender: EvolutionSender = {
      sendText: async (_c, _n, text) => {
        turns.push({ role: 'bot', text });
      },
      sendButtons: async (_c, _n, text, buttons) => {
        turns.push({ role: 'bot', text, buttons: buttons.map((b) => b.label) });
      },
      sendMedia: async (_c, _n, options) => {
        turns.push({ role: 'bot', text: `[${options.kind}] ${options.caption || options.media}` });
      },
    };

    const mockPorts: FlowPorts = {
      sender: mockSender,
      sessions: {
        read: () => memorySession,
        write: (_i, _p, sess) => {
          memorySession = sess;
        },
        clear: () => {
          memorySession = null;
        },
        clearFlow: () => {
          memorySession = null;
        },
      },
      logs: {
        appendTurn: () => {},
        listTurns: () => ({ turns: [] }),
      },
      contacts: {
        load: () => ({
          phoneHash: 'sim-hash',
          phoneTail: '1234',
          pushName: 'Visitante (Simulação)',
          attrs: fakeAttrs,
          tags: [],
          inboundCount: 1,
          optedOut: false,
        }),
        saveAttrs: (_i, _p, patch) => Object.assign(fakeAttrs, patch),
        setTags: () => {},
        appendMessage: (_i, _p, role, content) => {
          history.push({ role, content });
        },
        history: (_i, _p, limit) => history.slice(-limit),
      },
      ai: {
        complete: async (req) => ({
          text: `[IA Simulação: ${req.model}] Resposta simulada para sua pergunta.`,
          tokensIn: 30,
          tokensOut: 20,
        }),
        transcribe: async () => '[transcrição simulada]',
      },
      http: {
        request: async () => ({
          status: 200,
          data: { resultado: 'ok', id: 101 },
          text: '{"resultado":"ok","id":101}',
        }),
      },
      sql: {
        query: async () => [{ id: 1, item: 'Registro de Exemplo' }],
      },
      media: {
        fetchBase64: async () => ({ base64: '', mimetype: 'audio/ogg' }),
      },
    };

    for (const msg of messages) {
      turns.push({ role: 'user', text: msg });
      history.push({ role: 'user', content: msg });

      const ctx: FlowContext = {
        instance: 'simulacao',
        phone: '5511000001234',
        phoneHash: 'sim-hash',
        phoneTail: '1234',
        text: msg,
        vars: currentVars,
        stepsCount: 0,
      };

      if (memorySession?.waiting) {
        const waitingNode = nodeById(flow, memorySession.nodeId);
        if (waitingNode) {
          lastNodeId = waitingNode.id;
          const step = await this.resumeWaiting(flow, waitingNode, memorySession, ctx, null, mockPorts);
          currentVars = { ...ctx.vars };

          if (step.kind === 'reprompted') continue;
          if (step.kind === 'advance') {
            memorySession = await runFrom(flow, step.nextId, ctx, null, mockPorts);
            currentVars = { ...ctx.vars };
            continue;
          }
        }
        memorySession = null;
      }

      const trigger = flow.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, msg));
      if (trigger) {
        lastNodeId = trigger.id;
        memorySession = await runFrom(flow, trigger.id, ctx, null, mockPorts);
        currentVars = { ...ctx.vars };
      } else {
        turns.push({ role: 'bot', text: '[Nenhum gatilho compatível ativado]' });
      }
    }

    return {
      turns,
      vars: currentVars,
      lastNodeId: memorySession?.nodeId || lastNodeId,
    };
  }
}
