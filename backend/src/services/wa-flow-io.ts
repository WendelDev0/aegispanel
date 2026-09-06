import type { WaFlowRecord } from '../db/storage.js';
import { evolutionSendFailed, type EvolutionCredentials } from '../utils/evolution.client.js';
import type { FlowContext, FlowPorts, SendMediaOptions } from './wa-flow-ports.js';

export const emptyCreds: EvolutionCredentials = { apiUrl: '', apiKey: '', instance: '' };

/**
 * Delivery and turn logging, in one place.
 *
 * The engine repeated the same fourteen-line `appendTurn` literal after every
 * send, which is how two of them drifted into logging a different node type
 * than the one that had just run.
 */

export async function deliverText(
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

export async function deliverButtons(
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

export async function deliverMedia(
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  ports: FlowPorts,
  phone: string,
  options: SendMediaOptions
): Promise<boolean> {
  // Optional so an older sender (and every test mock written before media
  // existed) still satisfies the port. Reaching here with none means the
  // block cannot deliver, and the operator has to read that in the strip.
  if (!ports.sender.sendMedia) {
    ctx.sendError = 'Este canal não sabe enviar mídia.';
    return false;
  }
  const result = await ports.sender.sendMedia(creds ?? emptyCreds, phone, options);
  const err = evolutionSendFailed(result);
  if (err) {
    ctx.sendError = err;
    return false;
  }
  return true;
}

export async function logTurn(
  ports: FlowPorts,
  ctx: FlowContext,
  flow: WaFlowRecord,
  node: { id: string; type: string } | undefined,
  fields: {
    direction: 'in' | 'out';
    textExcerpt: string;
    error?: string;
    aiModel?: string;
    aiTokensIn?: number;
    aiTokensOut?: number;
  }
): Promise<void> {
  await ports.logs.appendTurn({
    at: new Date().toISOString(),
    instance: ctx.instance,
    flowId: flow.id,
    phoneHash: ctx.phoneHash,
    phoneTail: ctx.phoneTail,
    direction: fields.direction,
    nodeId: node?.id,
    nodeType: node?.type,
    textExcerpt: fields.textExcerpt.slice(0, 240),
    error: fields.error,
    aiModel: fields.aiModel,
    aiTokensIn: fields.aiTokensIn,
    aiTokensOut: fields.aiTokensOut,
  });
}

/**
 * Records why a gateway block failed.
 *
 * The customer only ever sees the fallback text, so without this the operator
 * cannot tell a missing API key from a refused model, an unreachable host from
 * one the SSRF guard blocked, or a write rejected by read mode. The flow still
 * follows its error edge — this only makes the reason reach the turn log.
 */
export async function logNodeError(
  ports: FlowPorts,
  ctx: FlowContext,
  flow: WaFlowRecord,
  node: { id: string; type: string },
  err: unknown
): Promise<void> {
  const message = String((err as Error)?.message || err || 'Falha desconhecida.');
  await logTurn(ports, ctx, flow, node, {
    direction: 'out',
    textExcerpt: `[${node.type}] falhou`,
    error: message.slice(0, 300),
  });
}
