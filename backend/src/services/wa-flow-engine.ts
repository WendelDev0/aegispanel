import type { WaFlowEdge, WaFlowNode, WaFlowRecord, WaPanelEvent } from '../db/storage.js';
import { dbStorage } from '../db/storage.js';
import {
  evolutionSendButtons,
  evolutionSendFailed,
  evolutionSendText,
  parseEvolutionUpsert,
  type EvolutionCredentials,
} from '../utils/evolution.client.js';
import { phoneHash, phoneTail } from '../utils/phone.js';
import { WaSessionStore } from '../utils/wa-session.store.js';
import { WaLogStore } from '../utils/wa-log.store.js';
import { WaInboundStore } from '../utils/wa-inbound.store.js';
import { WaFlowService } from './wa-flow.service.js';
import type {
  EvolutionSender,
  FlowPorts,
  FlowSessionStore,
  FlowLogStore,
  WaSession,
  WaTurnLog,
} from './wa-flow-ports.js';

export interface FlowContext {
  instance: string;
  phone: string;
  phoneHash: string;
  phoneTail: string;
  text: string;
  vars: Record<string, string>;
  stepsCount: number;
  sendError?: string;
}

const emptyCreds: EvolutionCredentials = { apiUrl: '', apiKey: '', instance: '' };

const defaultSender: EvolutionSender = {
  sendText: evolutionSendText,
  sendButtons: evolutionSendButtons,
};

const defaultPorts: FlowPorts = {
  sender: defaultSender,
  sessions: new WaSessionStore(),
  logs: new WaLogStore(),
};

// In-memory registry for active human handoffs: key = `${instance}__${phoneHash}` -> expiresAt
const activeHandoffs = new Map<string, number>();

export class HandoffManager {
  static set(instance: string, pHash: string, minutes = 120): void {
    const key = `${instance}__${pHash}`;
    const expiresAt = Date.now() + Math.max(5, Math.min(1440, minutes)) * 60 * 1000;
    activeHandoffs.set(key, expiresAt);
  }

  static isActive(instance: string, pHash: string): boolean {
    const key = `${instance}__${pHash}`;
    const expiresAt = activeHandoffs.get(key);
    if (!expiresAt) return false;
    if (Date.now() >= expiresAt) {
      activeHandoffs.delete(key);
      return false;
    }
    return true;
  }

  static release(instance: string, pHash: string): boolean {
    const key = `${instance}__${pHash}`;
    return activeHandoffs.delete(key);
  }

  static clear(): void {
    activeHandoffs.clear();
  }
}

export function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

function outgoing(flow: WaFlowRecord, nodeId: string, handle?: string): WaFlowEdge | undefined {
  const edges = flow.edges.filter((e) => e.source === nodeId);
  if (handle) {
    return edges.find((e) => e.sourceHandle === handle) || edges.find((e) => !e.sourceHandle);
  }
  return edges.find((e) => !e.sourceHandle) || edges[0];
}

function nodeById(flow: WaFlowRecord, id: string): WaFlowNode | undefined {
  return flow.nodes.find((n) => n.id === id);
}

function flowBoundToInstance(flow: WaFlowRecord, instance: string): boolean {
  const want = instance.trim().toLowerCase();
  if (!want) return false;
  return (flow.instanceNames || []).some((name) => String(name).trim().toLowerCase() === want);
}

function matchesTrigger(node: WaFlowNode, text: string): boolean {
  if (node.type !== 'trigger_message') return false;
  const match = node.data.match || 'any';
  const keyword = (node.data.keyword || '').trim();
  if (match === 'any' || !keyword) return true;
  const hay = text.toLowerCase();
  if (match === 'contains') return hay.includes(keyword.toLowerCase());
  try {
    return new RegExp(keyword, 'i').test(text);
  } catch {
    return hay.includes(keyword.toLowerCase());
  }
}

function evaluateCondition(node: WaFlowNode, ctx: FlowContext): boolean {
  const sourceVal = node.data.source === 'var' && node.data.varName
    ? String(ctx.vars[node.data.varName] ?? '')
    : ctx.text;

  const expected = (node.data.value || '').trim();
  const op = node.data.operator || 'contains';

  if (op === 'equals') return sourceVal.trim().toLowerCase() === expected.toLowerCase();
  if (op === 'contains') return sourceVal.toLowerCase().includes(expected.toLowerCase());
  if (op === 'exists') return sourceVal.trim().length > 0;
  if (op === 'regex') {
    try {
      return new RegExp(expected, 'i').test(sourceVal);
    } catch {
      return false;
    }
  }
  if (op === 'gt') {
    const num = parseFloat(sourceVal);
    const expNum = parseFloat(expected);
    return !Number.isNaN(num) && !Number.isNaN(expNum) && num > expNum;
  }
  if (op === 'lt') {
    const num = parseFloat(sourceVal);
    const expNum = parseFloat(expected);
    return !Number.isNaN(num) && !Number.isNaN(expNum) && num < expNum;
  }

  return false;
}

function pickMenuHandle(node: WaFlowNode, text: string): string | undefined {
  const buttons = node.data.buttons || [];
  const trimmed = text.trim();
  const asIndex = Number(trimmed);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= buttons.length) {
    return buttons[asIndex - 1].id;
  }
  const byId = buttons.find((b) => b.id === trimmed);
  if (byId) return byId.id;
  const byLabel = buttons.find((b) => b.label.toLowerCase() === trimmed.toLowerCase());
  return byLabel?.id;
}

function validateCaptureValue(type: string, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (type === 'number') {
    return !Number.isNaN(Number(trimmed));
  }
  if (type === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }
  if (type === 'phone') {
    const d = trimmed.replace(/\D/g, '');
    return d.length >= 8 && d.length <= 16;
  }
  return true;
}

async function deliverText(
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  ports: FlowPorts,
  phone: string,
  text: string
): Promise<boolean> {
  const result = await ports.sender.sendText(creds ?? emptyCreds, phone, text);
  const err = evolutionSendFailed(result);
  if (err) {
    ctx.sendError = err;
    return false;
  }
  return true;
}

async function deliverButtons(
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  ports: FlowPorts,
  phone: string,
  text: string,
  buttons: Array<{ id: string; label: string }>
): Promise<boolean> {
  const result = await ports.sender.sendButtons(creds ?? emptyCreds, phone, text, buttons);
  const err = evolutionSendFailed(result);
  if (err) {
    ctx.sendError = err;
    return false;
  }
  return true;
}

async function runFrom(
  flow: WaFlowRecord,
  startId: string,
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  ports: FlowPorts
): Promise<WaSession | null> {
  let current = nodeById(flow, startId);

  while (current && ctx.stepsCount < 40) {
    ctx.stepsCount += 1;

    // 1. Trigger nodes
    if (current.type === 'trigger_message' || current.type === 'trigger_event') {
      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 2. send_text
    if (current.type === 'send_text') {
      const body = applyVars(current.data.text || '', ctx.vars);
      if (body) {
        const sent = await deliverText(ctx, creds, ports, ctx.phone, body);
        if (!sent) {
          await ports.logs.appendTurn({
            at: new Date().toISOString(),
            instance: ctx.instance,
            flowId: flow.id,
            phoneHash: ctx.phoneHash,
            phoneTail: ctx.phoneTail,
            direction: 'out',
            nodeId: current.id,
            nodeType: current.type,
            textExcerpt: body.slice(0, 240),
            error: ctx.sendError,
          });
          return null;
        }
        await ports.logs.appendTurn({
          at: new Date().toISOString(),
          instance: ctx.instance,
          flowId: flow.id,
          phoneHash: ctx.phoneHash,
          phoneTail: ctx.phoneTail,
          direction: 'out',
          nodeId: current.id,
          nodeType: current.type,
          textExcerpt: body.slice(0, 240),
        });
      }
      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 3. menu
    if (current.type === 'menu') {
      const body = applyVars(current.data.text || 'Escolha uma opção:', ctx.vars);
      const buttons = current.data.buttons || [];
      const sent = await deliverButtons(ctx, creds, ports, ctx.phone, body, buttons);
      if (!sent) {
        await ports.logs.appendTurn({
          at: new Date().toISOString(),
          instance: ctx.instance,
          flowId: flow.id,
          phoneHash: ctx.phoneHash,
          phoneTail: ctx.phoneTail,
          direction: 'out',
          nodeId: current.id,
          nodeType: current.type,
          textExcerpt: body.slice(0, 240),
          error: ctx.sendError,
        });
        return null;
      }
      await ports.logs.appendTurn({
        at: new Date().toISOString(),
        instance: ctx.instance,
        flowId: flow.id,
        phoneHash: ctx.phoneHash,
        phoneTail: ctx.phoneTail,
        direction: 'out',
        nodeId: current.id,
        nodeType: current.type,
        textExcerpt: `${body} [${buttons.map((b) => b.label).join(', ')}]`.slice(0, 240),
      });
      return {
        flowId: flow.id,
        nodeId: current.id,
        waiting: true,
        lastText: ctx.text,
        vars: ctx.vars,
        attempts: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    // 4. wait_reply
    if (current.type === 'wait_reply') {
      return {
        flowId: flow.id,
        nodeId: current.id,
        waiting: true,
        lastText: ctx.text,
        vars: ctx.vars,
        attempts: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    // 5. capture
    if (current.type === 'capture') {
      const promptText = current.data.text ? applyVars(current.data.text, ctx.vars) : '';
      if (promptText) {
        const sent = await deliverText(ctx, creds, ports, ctx.phone, promptText);
        if (!sent) return null;
      }
      return {
        flowId: flow.id,
        nodeId: current.id,
        waiting: true,
        lastText: ctx.text,
        vars: ctx.vars,
        attempts: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    // 6. condition
    if (current.type === 'condition') {
      const pass = evaluateCondition(current, ctx);
      const handle = pass ? 'yes' : 'no';
      const next = outgoing(flow, current.id, handle);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 7. agent (AI)
    if (current.type === 'agent') {
      const nodeId = current.id;
      const fallbackText = current.data.fallbackText || 'Desculpe, ocorreu uma instabilidade temporária. Tente novamente.';
      const provider = current.data.provider || 'openai';
      const model = current.data.model || 'gpt-4o-mini';
      const systemPrompt = applyVars(current.data.systemPrompt || 'Você é um assistente útil e conciso.', ctx.vars);

      const todayTokens = flow.stats?.aiTokensToday || 0;
      const budget = flow.aiBudgetTokensPerDay ?? 50_000;

      if (budget > 0 && todayTokens >= budget) {
        // Budget exhausted
        const fallback = current.data.fallbackText || 'Nosso assistente de IA atingiu a cota diária. Em breve retornaremos!';
        const sent = await deliverText(ctx, creds, ports, ctx.phone, fallback);
        if (!sent) return null;
        const next = outgoing(flow, nodeId, 'error') || outgoing(flow, nodeId);
        current = next ? nodeById(flow, next.target) : undefined;
        continue;
      }

      if (ports.ai) {
        try {
          const res = await ports.ai.complete({
            provider,
            model,
            messages: [
              { role: 'system', content: `${systemPrompt}\n\nContexto:\n${JSON.stringify(ctx.vars)}` },
              { role: 'user', content: ctx.text },
            ],
            maxTokens: current.data.maxTokens || 512,
          });

          WaFlowService.markRun(flow.id, { aiTokens: (res.tokensIn || 0) + (res.tokensOut || 0) });

          // Send answer, splitting if > 1500 chars
          const text = res.text.slice(0, 1500);
          const sent = await deliverText(ctx, creds, ports, ctx.phone, text);
          if (!sent) return null;

          await ports.logs.appendTurn({
            at: new Date().toISOString(),
            instance: ctx.instance,
            flowId: flow.id,
            phoneHash: ctx.phoneHash,
            phoneTail: ctx.phoneTail,
            direction: 'out',
            nodeId: current.id,
            nodeType: current.type,
            textExcerpt: text.slice(0, 240),
            aiModel: model,
            aiTokensIn: res.tokensIn,
            aiTokensOut: res.tokensOut,
          });

          const next = outgoing(flow, current.id, 'next') || outgoing(flow, current.id);
          current = next ? nodeById(flow, next.target) : undefined;
          continue;
        } catch (err: any) {
          WaFlowService.markRun(flow.id, { error: true });
          const fallback = fallbackText;
          const sent = await deliverText(ctx, creds, ports, ctx.phone, fallback);
          if (!sent) return null;
          const next = outgoing(flow, nodeId, 'error');
          current = next ? nodeById(flow, next.target) : undefined;
          continue;
        }
      } else {
        // No AI provider injected: advance to next or error
        const next = outgoing(flow, nodeId, 'error') || outgoing(flow, nodeId);
        current = next ? nodeById(flow, next.target) : undefined;
        continue;
      }
    }

    // 8. http
    if (current.type === 'http') {
      const nodeId = current.id;
      if (ports.http && current.data.httpUrl) {
        try {
          const url = applyVars(current.data.httpUrl, ctx.vars);
          const body = current.data.httpBody ? applyVars(current.data.httpBody, ctx.vars) : undefined;
          const res = await ports.http.request({
            method: current.data.httpMethod || 'GET',
            url,
            headers: current.data.httpHeaders,
            body,
            timeoutMs: 8000,
          });

          if (res.status >= 200 && res.status < 300) {
            if (current.data.saveAs && res.data) {
              ctx.vars[current.data.saveAs] = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            }
            const next = outgoing(flow, nodeId, 'next') || outgoing(flow, nodeId);
            current = next ? nodeById(flow, next.target) : undefined;
            continue;
          } else {
            const next = outgoing(flow, nodeId, 'error');
            current = next ? nodeById(flow, next.target) : undefined;
            continue;
          }
        } catch {
          const next = outgoing(flow, nodeId, 'error');
          current = next ? nodeById(flow, next.target) : undefined;
          continue;
        }
      }
      const next = outgoing(flow, nodeId, 'next') || outgoing(flow, nodeId);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 9. sql
    if (current.type === 'sql') {
      const nodeId = current.id;
      if (ports.sql && current.data.sqlQuery) {
        try {
          const params = (current.data.sqlParams || []).map((p) => ctx.vars[p] ?? p);
          const rows = await ports.sql.query({
            text: current.data.sqlQuery,
            params,
            mode: current.data.sqlMode || 'read',
            databaseId: current.data.sqlDatabaseId,
            timeoutMs: 5000,
          });

          if (rows && rows.length > 0) {
            if (current.data.saveAs) {
              ctx.vars[current.data.saveAs] = JSON.stringify(rows[0]);
            }
            const next = outgoing(flow, nodeId, 'next') || outgoing(flow, nodeId);
            current = next ? nodeById(flow, next.target) : undefined;
            continue;
          } else {
            const next = outgoing(flow, nodeId, 'empty') || outgoing(flow, nodeId);
            current = next ? nodeById(flow, next.target) : undefined;
            continue;
          }
        } catch {
          const next = outgoing(flow, nodeId, 'error');
          current = next ? nodeById(flow, next.target) : undefined;
          continue;
        }
      }
      const next = outgoing(flow, nodeId, 'next') || outgoing(flow, nodeId);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 10. handoff
    if (current.type === 'handoff') {
      const minutes = current.data.resumeMinutes || 120;
      HandoffManager.set(ctx.instance, ctx.phoneHash, minutes);

      if (current.data.notifyNumber) {
        const msg = applyVars(
          current.data.notifyMessage || 'Transbordo humano solicitado por {{nome}} ({{telefone_final}})',
          ctx.vars
        );
        await deliverText(ctx, creds, ports, current.data.notifyNumber, msg);
      }

      await ports.logs.appendTurn({
        at: new Date().toISOString(),
        instance: ctx.instance,
        flowId: flow.id,
        phoneHash: ctx.phoneHash,
        phoneTail: ctx.phoneTail,
        direction: 'out',
        nodeId: current.id,
        nodeType: current.type,
        textExcerpt: `Handoff ativado por ${minutes} minutos`,
      });

      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 11. delay
    if (current.type === 'delay') {
      const sec = Math.max(0, Math.min(10, current.data.delaySeconds ?? 1));
      if (sec > 0 && typeof (globalThis as any).setTimeout === 'function') {
        await new Promise((r) => setTimeout(r, sec * 1000));
      }
      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    // 12. end
    if (current.type === 'end') {
      return null;
    }

    const next = outgoing(flow, current.id);
    current = next ? nodeById(flow, next.target) : undefined;
  }

  return null;
}

export class WaFlowEngine {
  static async handleInbound(
    body: unknown,
    customSender?: EvolutionSender,
    customPorts?: Partial<FlowPorts>
  ): Promise<boolean> {
    const inbound = parseEvolutionUpsert(body);
    if (!inbound) {
      WaInboundStore.record({ outcome: 'parse_failed' });
      return false;
    }

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
    // Reply from the instance that received the message, not Settings' leftover name.
    const creds = WaFlowService.evolutionCreds(instance);

    const ports: FlowPorts = {
      ...defaultPorts,
      ...customPorts,
      sender: customSender || customPorts?.sender || defaultPorts.sender,
    };

    const pHash = phoneHash(inbound.phone);
    const pTail = phoneTail(inbound.phone);

    // 1. Check if human handoff is active for this (instance, phone)
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

    // 2. Check active session
    const session = await ports.sessions.read(instance, inbound.phone);
    const now = new Date();
    const vars: Record<string, string> = {
      ...(session?.vars || {}),
      nome: inbound.pushName || session?.vars?.nome || '',
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
    };

    // Log inbound turn
    await ports.logs.appendTurn({
      at: now.toISOString(),
      instance,
      flowId: session?.flowId || 'unknown',
      phoneHash: pHash,
      phoneTail: pTail,
      direction: 'in',
      nodeId: session?.nodeId,
      textExcerpt: inbound.text.slice(0, 240),
    });

    if (session?.waiting) {
      const flow = dbStorage.getWaFlowById(session.flowId);
      const waitingNode = flow && flow.published ? nodeById(flow, session.nodeId) : undefined;

      if (flow && waitingNode) {
        ctx.vars = { ...vars };
        let nextId: string | undefined;

        if (waitingNode.type === 'menu') {
          const handle = pickMenuHandle(waitingNode, inbound.text);
          if (handle) {
            nextId = outgoing(flow, waitingNode.id, handle)?.target;
          } else {
            // Invalid button choice
            const attempts = (session.attempts || 0) + 1;
            if (attempts >= 2) {
              // follow fallback handle if present
              nextId = outgoing(flow, waitingNode.id, 'fallback')?.target || outgoing(flow, waitingNode.id)?.target;
            } else {
              // re-prompt menu
              await ports.sessions.write(instance, inbound.phone, { ...session, attempts });
              const bodyMsg = applyVars(waitingNode.data.text || 'Opção inválida. Escolha uma das opções:', ctx.vars);
              await deliverButtons(ctx, creds, ports, ctx.phone, bodyMsg, waitingNode.data.buttons || []);
              WaInboundStore.record({
                outcome: ctx.sendError ? 'send_failed' : 'handled',
                instance,
                phoneTail: pTail,
                textExcerpt: inbound.text,
                flowId: flow.id,
                flowName: flow.name,
                error: ctx.sendError,
              });
              return true;
            }
          }
        } else if (waitingNode.type === 'capture') {
          const capType = waitingNode.data.captureType || 'text';
          const isValid = validateCaptureValue(capType, inbound.text);

          if (isValid) {
            if (waitingNode.data.varName) {
              ctx.vars[waitingNode.data.varName] = inbound.text.trim();
            }
            nextId = outgoing(flow, waitingNode.id, 'next')?.target || outgoing(flow, waitingNode.id)?.target;
          } else {
            const attempts = (session.attempts || 0) + 1;
            if (attempts >= 3) {
              nextId = outgoing(flow, waitingNode.id, 'invalid')?.target;
            } else {
              await ports.sessions.write(instance, inbound.phone, { ...session, attempts });
              await deliverText(
                ctx,
                creds,
                ports,
                ctx.phone,
                `Formato inválido para ${capType}. Por favor, envie um valor válido.`
              );
              WaInboundStore.record({
                outcome: ctx.sendError ? 'send_failed' : 'handled',
                instance,
                phoneTail: pTail,
                textExcerpt: inbound.text,
                flowId: flow.id,
                flowName: flow.name,
                error: ctx.sendError,
              });
              return true;
            }
          }
        } else {
          nextId = outgoing(flow, waitingNode.id)?.target;
        }

        if (nextId) {
          const nextSession = await runFrom(flow, nextId, ctx, creds, ports);
          if (ctx.sendError) WaFlowService.markRun(flow.id, { error: true });
          else WaFlowService.markRun(flow.id);
          if (nextSession) {
            await ports.sessions.write(instance, inbound.phone, nextSession, flow.sessionTtlMinutes);
          } else {
            await ports.sessions.clear(instance, inbound.phone);
          }
          WaInboundStore.record({
            outcome: ctx.sendError ? 'send_failed' : 'handled',
            instance,
            phoneTail: pTail,
            textExcerpt: inbound.text,
            flowId: flow.id,
            flowName: flow.name,
            error: ctx.sendError,
          });
          return true;
        }
      }
      await ports.sessions.clear(instance, inbound.phone);
    }

    // 3. No active waiting session: Match against candidate flows
    // Flows must be published AND bound to this instance AND trigger matches
    const candidates = dbStorage
      .getWaFlows()
      .filter(
        (f) =>
          f.published &&
          flowBoundToInstance(f, instance) &&
          f.nodes.some((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text))
      );

    if (candidates.length === 0) {
      WaFlowService.recordUnmatched(instance);
      WaInboundStore.record({
        outcome: 'unmatched',
        instance,
        phoneTail: pTail,
        textExcerpt: inbound.text,
      });
      return false;
    }

    // Sort candidate flows deterministically:
    // 1. priority descending
    // 2. trigger specificity (regex > contains > any)
    // 3. updatedAt descending
    candidates.sort((a, b) => {
      const pDiff = (b.priority || 0) - (a.priority || 0);
      if (pDiff !== 0) return pDiff;

      const trigA = a.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text));
      const trigB = b.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text));

      const score = (t?: WaFlowNode) => {
        if (!t) return 0;
        if (t.data.match === 'regex') return 3;
        if (t.data.match === 'contains') return 2;
        return 1;
      };

      const sDiff = score(trigB) - score(trigA);
      if (sDiff !== 0) return sDiff;

      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

    const flow = candidates[0];
    const trigger = flow.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text));
    if (!trigger) return false;

    const nextSession = await runFrom(flow, trigger.id, ctx, creds, ports);
    if (ctx.sendError) WaFlowService.markRun(flow.id, { error: true });
    else WaFlowService.markRun(flow.id);
    if (nextSession) {
      await ports.sessions.write(instance, inbound.phone, nextSession, flow.sessionTtlMinutes);
    } else {
      await ports.sessions.clear(instance, inbound.phone);
    }
    WaInboundStore.record({
      outcome: ctx.sendError ? 'send_failed' : 'handled',
      instance,
      phoneTail: pTail,
      textExcerpt: inbound.text,
      flowId: flow.id,
      flowName: flow.name,
      error: ctx.sendError,
    });
    return true;
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
      .filter(
        (f) => f.published && f.nodes.some((n) => n.type === 'trigger_event' && n.data.event === event)
      );

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

      const ports: FlowPorts = {
        ...defaultPorts,
        sender,
      };

      await runFrom(flow, trigger.id, ctx, creds ? { ...creds, instance } : null, ports);
      WaFlowService.markRun(flow.id);
      ran += 1;
    }
    return ran;
  }

  static mapBroadcast(
    type: 'deploy' | 'alert' | 'backup',
    isError: boolean
  ): WaPanelEvent | null {
    if (type === 'deploy') return isError ? 'deploy_fail' : 'deploy_ok';
    if (type === 'backup') return 'backup';
    if (type === 'alert' && isError) return 'app_down';
    return null;
  }

  /**
   * Simulates a flow conversation in memory using fake ports without calling real APIs.
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
    let currentVars: Record<string, string> = { ...initialVars, nome: 'Visitante (Simulação)', telefone_final: '1234' };
    let memorySession: WaSession | null = null;
    let lastNodeId: string | undefined;

    const mockSender: EvolutionSender = {
      sendText: async (_c, _n, text) => {
        turns.push({ role: 'bot', text });
      },
      sendButtons: async (_c, _n, text, buttons) => {
        turns.push({ role: 'bot', text, buttons: buttons.map((b) => b.label) });
      },
    };

    const mockPorts: FlowPorts = {
      sender: mockSender,
      sessions: {
        read: () => memorySession,
        write: (_i, _p, sess) => { memorySession = sess; },
        clear: () => { memorySession = null; },
        clearFlow: () => { memorySession = null; },
      },
      logs: {
        appendTurn: () => {},
        listTurns: () => ({ turns: [] }),
      },
      ai: {
        complete: async (req) => ({
          text: `[IA Simulação: ${req.model}] Resposta simulada para sua pergunta.`,
          tokensIn: 30,
          tokensOut: 20,
        }),
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
    };

    for (const msg of messages) {
      turns.push({ role: 'user', text: msg });

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
          let nextId: string | undefined;

          if (waitingNode.type === 'menu') {
            const handle = pickMenuHandle(waitingNode, msg);
            nextId = handle ? outgoing(flow, waitingNode.id, handle)?.target : outgoing(flow, waitingNode.id)?.target;
          } else if (waitingNode.type === 'capture') {
            const varName = waitingNode.data.varName || 'captura';
            currentVars[varName] = msg;
            nextId = outgoing(flow, waitingNode.id, 'next')?.target || outgoing(flow, waitingNode.id)?.target;
          } else {
            nextId = outgoing(flow, waitingNode.id)?.target;
          }

          if (nextId) {
            memorySession = await runFrom(flow, nextId, ctx, null, mockPorts);
            currentVars = { ...ctx.vars };
            continue;
          }
        }
        memorySession = null;
      }

      // Find trigger
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
