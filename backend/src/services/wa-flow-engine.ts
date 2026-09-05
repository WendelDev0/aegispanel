import type { WaFlowEdge, WaFlowNode, WaFlowRecord, WaPanelEvent } from '../db/storage.js';
import { dbStorage } from '../db/storage.js';
import {
  evolutionSendButtons,
  evolutionSendText,
  parseEvolutionUpsert,
  type EvolutionCredentials,
} from '../utils/evolution.client.js';
import { WaSessionStore, type WaSession } from '../utils/wa-session.store.js';
import { WaFlowService } from './wa-flow.service.js';

export interface FlowContext {
  phone: string;
  text: string;
  vars: Record<string, string>;
}

export type EvolutionSender = {
  sendText: (creds: EvolutionCredentials, number: string, text: string) => Promise<unknown>;
  sendButtons: (
    creds: EvolutionCredentials,
    number: string,
    text: string,
    buttons: Array<{ id: string; label: string }>
  ) => Promise<unknown>;
};

const emptyCreds: EvolutionCredentials = { apiUrl: '', apiKey: '', instance: '' };

const defaultSender: EvolutionSender = {
  sendText: evolutionSendText,
  sendButtons: evolutionSendButtons,
};

function applyVars(text: string, vars: Record<string, string>): string {
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

function conditionPass(node: WaFlowNode, text: string): boolean {
  const expected = (node.data.value || '').trim();
  const op = node.data.operator || 'contains';
  if (op === 'equals') return text.trim().toLowerCase() === expected.toLowerCase();
  return text.toLowerCase().includes(expected.toLowerCase());
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

async function runFrom(
  flow: WaFlowRecord,
  startId: string,
  ctx: FlowContext,
  creds: EvolutionCredentials | null,
  sender: EvolutionSender
): Promise<WaSession | null> {
  let current = nodeById(flow, startId);
  let steps = 0;

  while (current && steps < 40) {
    steps += 1;

    if (current.type === 'trigger_message' || current.type === 'trigger_event') {
      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    if (current.type === 'send_text') {
      const body = applyVars(current.data.text || '', ctx.vars);
      if (body) await sender.sendText(creds ?? emptyCreds, ctx.phone, body);
      const next = outgoing(flow, current.id);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    if (current.type === 'menu') {
      const body = applyVars(current.data.text || 'Escolha uma opção:', ctx.vars);
      const buttons = current.data.buttons || [];
      await sender.sendButtons(creds ?? emptyCreds, ctx.phone, body, buttons);
      return {
        flowId: flow.id,
        nodeId: current.id,
        waiting: true,
        lastText: ctx.text,
        vars: ctx.vars,
        updatedAt: new Date().toISOString(),
      };
    }

    if (current.type === 'wait_reply') {
      return {
        flowId: flow.id,
        nodeId: current.id,
        waiting: true,
        lastText: ctx.text,
        vars: ctx.vars,
        updatedAt: new Date().toISOString(),
      };
    }

    if (current.type === 'condition') {
      const handle = conditionPass(current, ctx.text) ? 'yes' : 'no';
      const next = outgoing(flow, current.id, handle);
      current = next ? nodeById(flow, next.target) : undefined;
      continue;
    }

    if (current.type === 'end') {
      return null;
    }

    const next = outgoing(flow, current.id);
    current = next ? nodeById(flow, next.target) : undefined;
  }

  return null;
}

export class WaFlowEngine {
  static async handleInbound(body: unknown, sender: EvolutionSender = defaultSender): Promise<boolean> {
    const inbound = parseEvolutionUpsert(body);
    if (!inbound) return false;

    const creds = WaFlowService.evolutionCreds();
    const instance = inbound.instance || creds?.instance || '';
    if (!instance) return false;

    const session = WaSessionStore.read(instance, inbound.phone);
    const vars = {
      ...(session?.vars || {}),
      nome: inbound.pushName || session?.vars?.nome || '',
    };
    const ctx: FlowContext = { phone: inbound.phone, text: inbound.text, vars };

    if (session?.waiting) {
      const flow = dbStorage.getWaFlowById(session.flowId);
      const waitingNode = flow && flow.published ? nodeById(flow, session.nodeId) : undefined;
      if (flow && waitingNode) {
        ctx.vars = { ...vars };
        let nextId: string | undefined;
        if (waitingNode.type === 'menu') {
          const handle = pickMenuHandle(waitingNode, inbound.text);
          nextId = outgoing(flow, waitingNode.id, handle)?.target;
        } else {
          nextId = outgoing(flow, waitingNode.id)?.target;
        }
        if (nextId) {
          const nextSession = await runFrom(flow, nextId, ctx, creds, sender);
          WaFlowService.markRun(flow.id);
          if (nextSession) WaSessionStore.write(instance, inbound.phone, nextSession);
          else WaSessionStore.clear(instance, inbound.phone);
          return true;
        }
      }
      WaSessionStore.clear(instance, inbound.phone);
    }

    const flow = dbStorage
      .getWaFlows()
      .find(
        (f) =>
          f.published &&
          f.nodes.some((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text))
      );
    if (!flow) return false;

    const trigger = flow.nodes.find((n) => n.type === 'trigger_message' && matchesTrigger(n, inbound.text));
    if (!trigger) return false;

    const nextSession = await runFrom(flow, trigger.id, ctx, creds, sender);
    WaFlowService.markRun(flow.id);
    if (nextSession) WaSessionStore.write(instance, inbound.phone, nextSession);
    else WaSessionStore.clear(instance, inbound.phone);
    return true;
  }

  static async handlePanelEvent(
    event: WaPanelEvent,
    vars: Record<string, string>,
    sender: EvolutionSender = defaultSender
  ): Promise<number> {
    const creds = WaFlowService.evolutionCreds();
    const recipient = dbStorage.getSettings().alertConfig?.whatsappRecipientNumber;
    if (!creds || !recipient) return 0;

    const flows = dbStorage
      .getWaFlows()
      .filter(
        (f) => f.published && f.nodes.some((n) => n.type === 'trigger_event' && n.data.event === event)
      );

    let ran = 0;
    for (const flow of flows) {
      const trigger = flow.nodes.find((n) => n.type === 'trigger_event' && n.data.event === event);
      if (!trigger) continue;
      const ctx: FlowContext = {
        phone: recipient,
        text: vars.evento || event,
        vars: { evento: event, ...vars },
      };
      await runFrom(flow, trigger.id, ctx, creds, sender);
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
}
