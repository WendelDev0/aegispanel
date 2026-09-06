import type { WaFlowEdge, WaFlowNode, WaFlowRecord } from '../db/storage.js';
import type { FlowContext } from './wa-flow-ports.js';

/**
 * Pure graph and expression helpers.
 *
 * No I/O and no service imports, so the handlers, the engine and the
 * validator can all share one definition of "which edge does this node take".
 * They used to be private to the engine, which is why the simulator grew a
 * second, quietly divergent copy of the same rules.
 */

export function outgoing(flow: WaFlowRecord, nodeId: string, handle?: string): WaFlowEdge | undefined {
  const edges = flow.edges.filter((e) => e.source === nodeId);
  if (handle) {
    return edges.find((e) => e.sourceHandle === handle) || edges.find((e) => !e.sourceHandle);
  }
  return edges.find((e) => !e.sourceHandle) || edges[0];
}

export function nodeById(flow: WaFlowRecord, id: string): WaFlowNode | undefined {
  return flow.nodes.find((n) => n.id === id);
}

export function flowBoundToInstance(flow: WaFlowRecord, instance: string): boolean {
  const want = instance.trim().toLowerCase();
  if (!want) return false;
  return (flow.instanceNames || []).some((name) => String(name).trim().toLowerCase() === want);
}

export function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

export function matchesTrigger(node: WaFlowNode, text: string): boolean {
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

export function evaluateCondition(node: WaFlowNode, ctx: FlowContext): boolean {
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
  if (op === 'gt' || op === 'lt') {
    const num = parseFloat(sourceVal);
    const expNum = parseFloat(expected);
    if (Number.isNaN(num) || Number.isNaN(expNum)) return false;
    return op === 'gt' ? num > expNum : num < expNum;
  }

  return false;
}

export function pickMenuHandle(node: WaFlowNode, text: string): string | undefined {
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

export function validateCaptureValue(type: string, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (type === 'number') return !Number.isNaN(Number(trimmed));
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  if (type === 'phone') {
    const d = trimmed.replace(/\D/g, '');
    return d.length >= 8 && d.length <= 16;
  }
  return true;
}

/** The session a waiting node parks on. Shared so resume and simulate agree. */
export function sessionAt(
  flow: WaFlowRecord,
  node: WaFlowNode,
  ctx: FlowContext
): {
  flowId: string;
  nodeId: string;
  waiting: true;
  lastText: string;
  vars: Record<string, string>;
  attempts: number;
  updatedAt: string;
} {
  return {
    flowId: flow.id,
    nodeId: node.id,
    waiting: true,
    lastText: ctx.text,
    vars: ctx.vars,
    attempts: 0,
    updatedAt: new Date().toISOString(),
  };
}
