import type { WaFlowNode, WaFlowNodeType, WaFlowRecord } from '../db/storage.js';
import type { EvolutionCredentials } from '../utils/evolution.client.js';
import { HandoffManager } from './wa-flow-handoff.js';
import { applyVars, evaluateCondition, outgoing } from './wa-flow-graph.js';
import { deliverButtons, deliverMedia, deliverText, logNodeError, logTurn } from './wa-flow-io.js';
import { WaFlowService } from './wa-flow.service.js';
import type {
  AiMessage,
  AiToolCall,
  AiToolDefinition,
  FlowContext,
  FlowPorts,
} from './wa-flow-ports.js';

/**
 * What a block tells the walker to do next.
 *
 * `runFrom` used to be four hundred lines of `if (current.type === …)` with
 * the advance-to-next-node dance copied into each branch. Adding a block
 * meant editing the middle of that function and repeating the same four
 * lines; getting the handle wrong in one of them was invisible until a
 * customer took the wrong branch.
 */
export type HandlerResult =
  | { kind: 'goto'; handle?: string }
  | { kind: 'jump'; nodeId: string }
  | { kind: 'wait' }
  | { kind: 'stop' };

export interface NodeRun {
  flow: WaFlowRecord;
  node: WaFlowNode;
  ctx: FlowContext;
  creds: EvolutionCredentials | null;
  ports: FlowPorts;
}

export type NodeHandler = (run: NodeRun) => Promise<HandlerResult>;

const NEXT: HandlerResult = { kind: 'goto' };
const MAX_TOOL_ROUNDS = 3;

// --- individual blocks -----------------------------------------------------

const trigger: NodeHandler = async () => NEXT;

const sendText: NodeHandler = async ({ flow, node, ctx, creds, ports }) => {
  const body = applyVars(node.data.text || '', ctx.vars);
  if (!body) return NEXT;

  const sent = await deliverText(ctx, creds, ports, ctx.phone, body);
  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: body,
    error: sent ? undefined : ctx.sendError,
  });
  if (!sent) return { kind: 'stop' };

  ports.contacts.appendMessage(ctx.instance, ctx.phoneHash, 'assistant', body, flow.id);
  return NEXT;
};

const menu: NodeHandler = async ({ flow, node, ctx, creds, ports }) => {
  const body = applyVars(node.data.text || 'Escolha uma opção:', ctx.vars);
  const buttons = node.data.buttons || [];

  const sent = await deliverButtons(ctx, creds, ports, ctx.phone, body, buttons);
  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: sent ? `${body} [${buttons.map((b) => b.label).join(', ')}]` : body,
    error: sent ? undefined : ctx.sendError,
  });
  if (!sent) return { kind: 'stop' };

  ports.contacts.appendMessage(ctx.instance, ctx.phoneHash, 'assistant', body, flow.id);
  return { kind: 'wait' };
};

const waitReply: NodeHandler = async () => ({ kind: 'wait' });

const capture: NodeHandler = async ({ flow, node, ctx, creds, ports }) => {
  const promptText = node.data.text ? applyVars(node.data.text, ctx.vars) : '';
  if (promptText) {
    const sent = await deliverText(ctx, creds, ports, ctx.phone, promptText);
    if (!sent) return { kind: 'stop' };
    ports.contacts.appendMessage(ctx.instance, ctx.phoneHash, 'assistant', promptText, flow.id);
  }
  return { kind: 'wait' };
};

const condition: NodeHandler = async ({ node, ctx }) => ({
  kind: 'goto',
  handle: evaluateCondition(node, ctx) ? 'yes' : 'no',
});

const sendMedia: NodeHandler = async ({ flow, node, ctx, creds, ports }) => {
  const url = applyVars(node.data.mediaUrl || '', ctx.vars).trim();
  if (!url) {
    await logNodeError(ports, ctx, flow, node, new Error('Bloco de mídia sem URL configurada.'));
    return { kind: 'goto', handle: 'error' };
  }

  const kind = node.data.mediaKind || 'image';
  const caption = node.data.text ? applyVars(node.data.text, ctx.vars) : undefined;

  const sent = await deliverMedia(ctx, creds, ports, ctx.phone, {
    kind,
    media: url,
    caption,
    fileName: node.data.mediaFileName,
    mimetype: node.data.mediaMimetype,
  });

  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: `[${kind}] ${caption || url}`,
    error: sent ? undefined : ctx.sendError,
  });
  if (!sent) return { kind: 'stop' };

  ports.contacts.appendMessage(
    ctx.instance,
    ctx.phoneHash,
    'assistant',
    caption ? `[${kind}] ${caption}` : `[${kind}]`,
    flow.id
  );
  return NEXT;
};

/**
 * Writes to the contact, which outlives the session.
 *
 * Tags are what a segment is built from later; keeping them out of `vars` is
 * the whole point, since vars expire with the conversation.
 */
const contact: NodeHandler = async ({ flow, node, ctx, ports }) => {
  const patch: Record<string, string> = {};
  for (const entry of node.data.contactAttrs || []) {
    if (!entry?.key) continue;
    patch[entry.key] = applyVars(String(entry.value ?? ''), ctx.vars);
  }
  if (Object.keys(patch).length) {
    ctx.contactPatch = { ...(ctx.contactPatch || {}), ...patch };
    ports.contacts.saveAttrs(ctx.instance, ctx.phoneHash, patch);
    if (ctx.contact) ctx.contact.attrs = { ...ctx.contact.attrs, ...patch };
  }

  const add = (node.data.addTags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const remove = new Set((node.data.removeTags || []).map((t) => String(t).trim().toLowerCase()));
  if (add.length || remove.size) {
    const current = ctx.contact?.tags || [];
    const next = Array.from(new Set([...current, ...add])).filter((t) => !remove.has(t));
    ports.contacts.setTags(ctx.instance, ctx.phoneHash, next);
    if (ctx.contact) ctx.contact.tags = next;
  }

  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: `Contato atualizado${add.length ? ` +${add.join(',')}` : ''}${remove.size ? ` -${[...remove].join(',')}` : ''}`,
  });
  return NEXT;
};

// --- AI agent --------------------------------------------------------------

/**
 * Builds the tools the model may call.
 *
 * A tool is always an `http` or `sql` block that already exists in the same
 * flow, so whatever the model reaches was configured, validated and guarded
 * by the operator — the SSRF allowlist, the read/write mode and the bound
 * database all still apply. The model chooses *when* to call it and with what
 * arguments; it never chooses *what* it may reach.
 */
function resolveTools(flow: WaFlowRecord, node: WaFlowNode): {
  definitions: AiToolDefinition[];
  byName: Map<string, { node: WaFlowNode; params: string[] }>;
} {
  const definitions: AiToolDefinition[] = [];
  const byName = new Map<string, { node: WaFlowNode; params: string[] }>();

  for (const tool of node.data.agentTools || []) {
    const target = flow.nodes.find((n) => n.id === tool.nodeId);
    if (!target || (target.type !== 'http' && target.type !== 'sql')) continue;

    const name = String(tool.name || '').trim().slice(0, 48);
    if (!name || byName.has(name)) continue;

    const params = (tool.parameters || []).map((p) => String(p.name || '').trim()).filter(Boolean);
    definitions.push({
      name,
      description: String(tool.description || `Executa o bloco ${target.type}`).slice(0, 300),
      parameters: (tool.parameters || [])
        .filter((p) => p?.name)
        .map((p) => ({
          name: String(p.name).trim(),
          description: p.description ? String(p.description).slice(0, 200) : undefined,
          required: p.required !== false,
        })),
    });
    byName.set(name, { node: target, params });
  }

  return { definitions, byName };
}

async function runToolCall(
  call: AiToolCall,
  resolved: { node: WaFlowNode; params: string[] },
  run: NodeRun
): Promise<string> {
  const { ctx, flow, ports } = run;
  // Arguments become variables for this call only: a model that invents a
  // value must not overwrite what a capture block stored on the customer.
  const scoped = { ...ctx.vars, ...call.arguments };
  const target = resolved.node;

  if (target.type === 'http') {
    if (!ports.http) throw new Error('Gateway HTTP indisponível.');
    const res = await ports.http.request({
      method: target.data.httpMethod || 'GET',
      url: applyVars(target.data.httpUrl || '', scoped),
      headers: target.data.httpHeaders,
      body: target.data.httpBody ? applyVars(target.data.httpBody, scoped) : undefined,
      timeoutMs: 8000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`A chamada respondeu HTTP ${res.status}.`);
    }
    return typeof res.data === 'string' ? res.data.slice(0, 2000) : JSON.stringify(res.data).slice(0, 2000);
  }

  if (!ports.sql) throw new Error('Gateway SQL indisponível.');
  const params = (target.data.sqlParams || []).map((p) => scoped[p] ?? p);
  const rows = await ports.sql.query({
    text: target.data.sqlQuery || '',
    params,
    mode: target.data.sqlMode || 'read',
    databaseId: target.data.sqlDatabaseId || flow.dataBinding?.postgresDatabaseId,
    timeoutMs: 5000,
  });
  return JSON.stringify(rows.slice(0, 10)).slice(0, 2000);
}

const agent: NodeHandler = async (run) => {
  const { flow, node, ctx, creds, ports } = run;
  const fallbackText =
    node.data.fallbackText || 'Desculpe, ocorreu uma instabilidade temporária. Tente novamente.';
  const provider = node.data.provider || 'openai';
  const model = node.data.model || 'gpt-4o-mini';
  const systemPrompt = applyVars(
    node.data.systemPrompt || 'Você é um assistente útil e conciso.',
    ctx.vars
  );

  // Pending deltas merged: the counter is buffered off the message path, so
  // reading the stored flow alone let a burst of messages spend past the cap
  // before a single flush had happened.
  const live = WaFlowService.withPendingStats(flow);
  const todayTokens = live.stats?.aiTokensToday || 0;
  const budget = flow.aiBudgetTokensPerDay ?? 50_000;

  if (budget > 0 && todayTokens >= budget) {
    const exhausted =
      node.data.fallbackText || 'Nosso assistente de IA atingiu a cota diária. Em breve retornaremos!';
    const sent = await deliverText(ctx, creds, ports, ctx.phone, exhausted);
    if (!sent) return { kind: 'stop' };
    return { kind: 'goto', handle: 'error' };
  }

  if (!ports.ai) {
    WaFlowService.markRun(flow.id, { error: true });
    await logNodeError(
      ports,
      ctx,
      flow,
      node,
      new Error('Nenhum provedor de IA disponível neste painel.')
    );
    return { kind: 'goto', handle: 'error' };
  }

  const { definitions, byName } = resolveTools(flow, node);

  /**
   * Memory comes from the contact's own thread, not from the flow's turn log.
   *
   * `memoryTurns` was configurable in the UI and read by nothing: every call
   * sent the system prompt and the single last message, so the assistant
   * asked for the customer's name again one message after being told it.
   */
  const memoryTurns = Math.max(1, Math.min(30, node.data.memoryTurns ?? 12));
  const history = ports.contacts.history(ctx.instance, ctx.phoneHash, memoryTurns * 2);

  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `${systemPrompt}\n\nContexto:\n${JSON.stringify(ctx.vars)}`,
    },
    ...history.map((h) => ({ role: h.role, content: h.content } as AiMessage)),
  ];
  if (history[history.length - 1]?.content !== ctx.text) {
    messages.push({ role: 'user', content: ctx.text });
  }

  try {
    let rounds = 0;
    let answer = '';
    let tokensIn = 0;
    let tokensOut = 0;

    // The model may ask for data before it can answer. Bounded, because a
    // loop of tool calls is billed per round and the customer is waiting.
    for (;;) {
      const res = await ports.ai.complete({
        provider,
        model,
        messages,
        maxTokens: node.data.maxTokens || 512,
        tools: definitions.length ? definitions : undefined,
      });

      tokensIn += res.tokensIn || 0;
      tokensOut += res.tokensOut || 0;

      if (!res.toolCalls?.length || rounds >= MAX_TOOL_ROUNDS) {
        answer = res.text;
        break;
      }

      rounds += 1;
      messages.push({ role: 'assistant', content: res.text || '', toolCalls: res.toolCalls });

      for (const call of res.toolCalls) {
        const resolved = byName.get(call.name);
        let output: string;
        if (!resolved) {
          output = `Ferramenta "${call.name}" não existe neste fluxo.`;
        } else {
          try {
            output = await runToolCall(call, resolved, run);
          } catch (err: any) {
            // Handed back to the model rather than thrown: a failed lookup is
            // something it can tell the customer about, and taking the error
            // edge here would throw away an answer it could still give.
            output = `Erro ao executar "${call.name}": ${String(err?.message || err).slice(0, 200)}`;
            await logNodeError(ports, ctx, flow, node, err);
          }
        }
        messages.push({ role: 'tool', content: output, toolCallId: call.id });
      }
    }

    WaFlowService.markRun(flow.id, { aiTokens: tokensIn + tokensOut });

    const text = (answer || fallbackText).slice(0, 1500);
    const sent = await deliverText(ctx, creds, ports, ctx.phone, text);
    if (!sent) return { kind: 'stop' };

    ports.contacts.appendMessage(ctx.instance, ctx.phoneHash, 'assistant', text, flow.id);
    await logTurn(ports, ctx, flow, node, {
      direction: 'out',
      textExcerpt: text,
      aiModel: model,
      aiTokensIn: tokensIn,
      aiTokensOut: tokensOut,
    });

    if (node.data.saveAs) ctx.vars[node.data.saveAs] = text;
    return { kind: 'goto', handle: 'next' };
  } catch (err: any) {
    WaFlowService.markRun(flow.id, { error: true });
    await logNodeError(ports, ctx, flow, node, err);
    const sent = await deliverText(ctx, creds, ports, ctx.phone, fallbackText);
    if (!sent) return { kind: 'stop' };
    return { kind: 'goto', handle: 'error' };
  }
};

// --- gateways --------------------------------------------------------------

const http: NodeHandler = async ({ flow, node, ctx, ports }) => {
  if (!ports.http || !node.data.httpUrl) return { kind: 'goto', handle: 'next' };

  try {
    const res = await ports.http.request({
      method: node.data.httpMethod || 'GET',
      url: applyVars(node.data.httpUrl, ctx.vars),
      headers: node.data.httpHeaders,
      body: node.data.httpBody ? applyVars(node.data.httpBody, ctx.vars) : undefined,
      timeoutMs: 8000,
    });

    if (res.status >= 200 && res.status < 300) {
      if (node.data.saveAs && res.data) {
        ctx.vars[node.data.saveAs] =
          typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      }
      return { kind: 'goto', handle: 'next' };
    }

    await logNodeError(ports, ctx, flow, node, new Error(`A chamada respondeu HTTP ${res.status}.`));
    return { kind: 'goto', handle: 'error' };
  } catch (err: any) {
    // Includes the SSRF guard's refusal, which is the message that tells the
    // operator to allowlist the host instead of guessing.
    await logNodeError(ports, ctx, flow, node, err);
    return { kind: 'goto', handle: 'error' };
  }
};

const sql: NodeHandler = async ({ flow, node, ctx, ports }) => {
  if (!ports.sql || !node.data.sqlQuery) return { kind: 'goto', handle: 'next' };

  try {
    const params = (node.data.sqlParams || []).map((p) => ctx.vars[p] ?? p);
    const rows = await ports.sql.query({
      text: node.data.sqlQuery,
      params,
      mode: node.data.sqlMode || 'read',
      // The flow-level binding is the default so every SQL block in a flow
      // does not have to repeat the same database.
      databaseId: node.data.sqlDatabaseId || flow.dataBinding?.postgresDatabaseId,
      timeoutMs: 5000,
    });

    if (!rows || rows.length === 0) return { kind: 'goto', handle: 'empty' };
    if (node.data.saveAs) ctx.vars[node.data.saveAs] = JSON.stringify(rows[0]);
    return { kind: 'goto', handle: 'next' };
  } catch (err: any) {
    // A refused write, a wrong database or a driver error all used to look
    // the same from the outside: the flow silently took the error edge and
    // nothing said why.
    await logNodeError(ports, ctx, flow, node, err);
    return { kind: 'goto', handle: 'error' };
  }
};

// --- flow control ----------------------------------------------------------

const handoff: NodeHandler = async ({ flow, node, ctx, creds, ports }) => {
  const minutes = node.data.resumeMinutes || 120;
  HandoffManager.set(ctx.instance, ctx.phoneHash, minutes);

  if (node.data.notifyNumber) {
    const msg = applyVars(
      node.data.notifyMessage || 'Transbordo humano solicitado por {{nome}} ({{telefone_final}})',
      ctx.vars
    );
    await deliverText(ctx, creds, ports, node.data.notifyNumber, msg);
  }

  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: `Handoff ativado por ${minutes} minutos`,
  });
  return NEXT;
};

const delay: NodeHandler = async ({ node, ctx, creds, ports }) => {
  const sec = Math.max(0, Math.min(10, node.data.delaySeconds ?? 1));
  if (sec <= 0) return NEXT;

  // "digitando…" for the length of the pause. The port existed and nothing
  // called it, so the block the UI describes as keeping the typing indicator
  // on simply went quiet for a few seconds.
  if (ports.sender.sendPresence && creds) {
    await ports.sender.sendPresence(creds, ctx.phone, 'composing').catch(() => undefined);
  }
  if (typeof (globalThis as any).setTimeout === 'function') {
    await new Promise((r) => setTimeout(r, sec * 1000));
  }
  return NEXT;
};

const end: NodeHandler = async () => ({ kind: 'stop' });

export const NODE_HANDLERS: Record<WaFlowNodeType, NodeHandler> = {
  trigger_message: trigger,
  trigger_event: trigger,
  send_text: sendText,
  send_media: sendMedia,
  menu,
  wait_reply: waitReply,
  capture,
  condition,
  contact,
  agent,
  http,
  sql,
  handoff,
  delay,
  end,
};

/** Blocks that park the conversation waiting for the customer to reply. */
export const WAITING_TYPES: ReadonlySet<WaFlowNodeType> = new Set<WaFlowNodeType>([
  'wait_reply',
  'menu',
  'capture',
]);

export { outgoing };
