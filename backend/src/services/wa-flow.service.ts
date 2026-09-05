import crypto from 'crypto';
import { dbStorage, type WaFlowEdge, type WaFlowNode, type WaFlowRecord } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { getPublicBaseUrl } from '../utils/public-url.js';
import {
  evolutionClearWebhook,
  evolutionSetWebhook,
  type EvolutionCredentials,
} from '../utils/evolution.client.js';
import { WaSessionStore } from '../utils/wa-session.store.js';
import { validateFlowGraph, type ValidationResult } from './wa-flow-validator.js';
import { WA_FLOW_TEMPLATES } from './wa-flow-templates.js';

const NODE_TYPES = new Set([
  'trigger_message',
  'trigger_event',
  'send_text',
  'menu',
  'wait_reply',
  'capture',
  'condition',
  'agent',
  'http',
  'sql',
  'handoff',
  'delay',
  'end',
]);

export interface CreateFlowInput {
  name: string;
  nodes?: WaFlowNode[];
  edges?: WaFlowEdge[];
  instanceNames?: string[];
  priority?: number;
  sessionTtlMinutes?: number;
  aiBudgetTokensPerDay?: number;
  dataBinding?: {
    postgresDatabaseId?: string;
    redisDatabaseId?: string;
  };
  templateId?: string;
}

export interface UpdateFlowInput {
  name?: string;
  nodes?: WaFlowNode[];
  edges?: WaFlowEdge[];
  instanceNames?: string[];
  priority?: number;
  sessionTtlMinutes?: number;
  aiBudgetTokensPerDay?: number;
  dataBinding?: {
    postgresDatabaseId?: string;
    redisDatabaseId?: string;
  };
}

export class WaFlowService {
  static list(): WaFlowRecord[] {
    return dbStorage.getWaFlows();
  }

  static get(id: string): WaFlowRecord {
    const flow = dbStorage.getWaFlowById(id);
    if (!flow) throw new Error('Fluxo não encontrado');
    return flow;
  }

  static create(input: CreateFlowInput): WaFlowRecord {
    const name = input.name.trim();
    if (!name) throw new Error('Nome do fluxo é obrigatório.');

    let nodes = input.nodes || [];
    let edges = input.edges || [];

    if (input.templateId) {
      const tmpl = WA_FLOW_TEMPLATES.find((t) => t.id === input.templateId);
      if (tmpl) {
        nodes = tmpl.nodes;
        edges = tmpl.edges;
      }
    }

    const now = new Date().toISOString();
    const todayStr = now.slice(0, 10);
    const instanceNames = Array.isArray(input.instanceNames)
      ? input.instanceNames.map((n) => String(n).trim()).filter(Boolean)
      : [];
    const fallbackInstance = (this.evolutionCreds()?.instance || '').trim();

    const flow: WaFlowRecord = {
      id: `waflow-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      name: name.slice(0, 80),
      published: false,
      nodes: this.sanitizeNodes(nodes),
      edges: this.sanitizeEdges(edges),
      instanceNames: instanceNames.length ? instanceNames : (fallbackInstance ? [fallbackInstance] : []),
      priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
      sessionTtlMinutes: Math.max(5, Math.min(1440, Number(input.sessionTtlMinutes) || 30)),
      aiBudgetTokensPerDay: Math.max(0, Number(input.aiBudgetTokensPerDay) || 50_000),
      dataBinding: input.dataBinding,
      stats: {
        runsToday: 0,
        aiTokensToday: 0,
        errorsToday: 0,
        unmatchedToday: 0,
        day: todayStr,
      },
      createdAt: now,
      updatedAt: now,
    };

    return dbStorage.saveWaFlow(flow);
  }

  static update(id: string, patch: UpdateFlowInput): WaFlowRecord {
    const current = this.get(id);

    const updated: WaFlowRecord = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim().slice(0, 80) || current.name : current.name,
      nodes: patch.nodes ? this.sanitizeNodes(patch.nodes) : current.nodes,
      edges: patch.edges ? this.sanitizeEdges(patch.edges) : current.edges,
      instanceNames: patch.instanceNames !== undefined
        ? patch.instanceNames.map((n) => String(n).trim()).filter(Boolean)
        : current.instanceNames,
      priority: patch.priority !== undefined && Number.isFinite(patch.priority)
        ? Number(patch.priority)
        : current.priority,
      sessionTtlMinutes: patch.sessionTtlMinutes !== undefined
        ? Math.max(5, Math.min(1440, Number(patch.sessionTtlMinutes) || 30))
        : current.sessionTtlMinutes,
      aiBudgetTokensPerDay: patch.aiBudgetTokensPerDay !== undefined
        ? Math.max(0, Number(patch.aiBudgetTokensPerDay) || 0)
        : current.aiBudgetTokensPerDay,
      dataBinding: patch.dataBinding !== undefined ? patch.dataBinding : current.dataBinding,
      updatedAt: new Date().toISOString(),
    };

    return dbStorage.saveWaFlow(updated);
  }

  static clone(id: string): WaFlowRecord {
    const current = this.get(id);
    const now = new Date().toISOString();
    const todayStr = now.slice(0, 10);

    const cloned: WaFlowRecord = {
      ...current,
      id: `waflow-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      name: `${current.name} (cópia)`.slice(0, 80),
      published: false,
      nodes: current.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: current.edges.map((e) => ({ ...e })),
      stats: {
        runsToday: 0,
        aiTokensToday: 0,
        errorsToday: 0,
        unmatchedToday: 0,
        day: todayStr,
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: undefined,
    };

    return dbStorage.saveWaFlow(cloned);
  }

  static remove(id: string): void {
    this.get(id);
    dbStorage.removeWaFlow(id);
    WaSessionStore.clearFlow(id);
  }

  static validate(id: string): ValidationResult {
    const flow = this.get(id);
    return validateFlowGraph(flow.nodes, flow.edges);
  }

  static evolutionCreds(instanceName?: string): EvolutionCredentials | null {
    const settings = dbStorage.getSettings();
    const evo = settings.evolution;
    if (evo?.apiUrl && evo?.apiKey) {
      return {
        apiUrl: evo.apiUrl,
        apiKey: evo.apiKey,
        instance: instanceName || settings.alertConfig?.whatsappInstance || '',
      };
    }

    const cfg = settings.alertConfig;
    if (cfg?.whatsappApiUrl && cfg.whatsappApiKey) {
      return {
        apiUrl: cfg.whatsappApiUrl,
        apiKey: cfg.whatsappApiKey,
        instance: instanceName || cfg.whatsappInstance || '',
      };
    }

    return null;
  }

  static webhookSecret(): string {
    const settings = dbStorage.getSettings();
    if (settings.waFlowWebhookSecret) {
      return EncryptionService.tryDecrypt(settings.waFlowWebhookSecret) ?? settings.waFlowWebhookSecret;
    }
    const raw = crypto.randomBytes(24).toString('hex');
    dbStorage.updateSettings({ waFlowWebhookSecret: EncryptionService.encrypt(raw) });
    return raw;
  }

  static webhookUrl(): string {
    const base = getPublicBaseUrl(dbStorage.getSettings());
    if (!base) {
      throw new Error('Configure o domínio do painel ou AEGIS_PUBLIC_BASE_URL antes de publicar.');
    }
    return `${base}/api/wa-flows/webhook?token=${encodeURIComponent(this.webhookSecret())}`;
  }

  static async publish(id: string, published: boolean): Promise<WaFlowRecord> {
    const flow = this.get(id);
    const creds = this.evolutionCreds();

    if (published) {
      if (!creds || !creds.apiUrl || !creds.apiKey) {
        throw new Error('Configure a Evolution API em Configurações antes de publicar.');
      }
      if (!Array.isArray(flow.instanceNames) || flow.instanceNames.length === 0) {
        throw new Error('Vincule pelo menos uma instância ao fluxo antes de publicar.');
      }

      // 1. Pure graph validation
      const validation = validateFlowGraph(flow.nodes, flow.edges);
      if (!validation.valid) {
        const first = validation.errors[0]?.message || 'O grafo do fluxo contém erros.';
        throw new Error(`Não é possível publicar: ${first}`);
      }

      // 2. Register webhook on each bound instance
      const webhookUrl = this.webhookUrl();
      const webhookHeaders = { 'x-aegis-wa-secret': this.webhookSecret() };
      for (const inst of flow.instanceNames) {
        const result = await evolutionSetWebhook({ ...creds, instance: inst }, webhookUrl, webhookHeaders);
        if (!result.ok && result.skipped !== 'local_mode') {
          throw new Error(result.error || `Não foi possível registrar o webhook na instância "${inst}".`);
        }
      }
    } else {
      // Unpublishing: clear webhook ONLY if no other published flow uses this instance
      if (creds) {
        const otherFlows = dbStorage.getWaFlows().filter((f) => f.published && f.id !== id);
        for (const inst of flow.instanceNames || []) {
          const usedByOther = otherFlows.some((f) => f.instanceNames?.includes(inst));
          if (!usedByOther) {
            await evolutionClearWebhook({ ...creds, instance: inst });
          }
        }
      }
      WaSessionStore.clearFlow(id);
    }

    const updated: WaFlowRecord = {
      ...flow,
      published,
      updatedAt: new Date().toISOString(),
    };
    return dbStorage.saveWaFlow(updated);
  }

  static markRun(id: string, details?: { aiTokens?: number; error?: boolean }): void {
    const flow = dbStorage.getWaFlowById(id);
    if (!flow) return;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const stats = flow.stats && flow.stats.day === todayStr
      ? { ...flow.stats }
      : { runsToday: 0, aiTokensToday: 0, errorsToday: 0, unmatchedToday: 0, day: todayStr };

    stats.runsToday += 1;
    if (details?.aiTokens) stats.aiTokensToday += details.aiTokens;
    if (details?.error) stats.errorsToday += 1;

    dbStorage.saveWaFlow({
      ...flow,
      stats,
      lastRunAt: now.toISOString(),
    });
  }

  static recordUnmatched(instance: string): void {
    // Increment unmatchedToday on published flows matching this instance
    const want = instance.trim().toLowerCase();
    const flows = dbStorage.getWaFlows().filter(
      (f) =>
        f.published &&
        (f.instanceNames || []).some((name) => String(name).trim().toLowerCase() === want)
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const flow of flows) {
      const stats = flow.stats && flow.stats.day === todayStr
        ? { ...flow.stats }
        : { runsToday: 0, aiTokensToday: 0, errorsToday: 0, unmatchedToday: 0, day: todayStr };
      stats.unmatchedToday = (stats.unmatchedToday || 0) + 1;
      dbStorage.saveWaFlow({ ...flow, stats });
    }
  }

  static getAggregatedStats(): {
    totalFlows: number;
    publishedFlows: number;
    runsToday: number;
    aiTokensToday: number;
    errorsToday: number;
    unmatchedToday: number;
  } {
    const flows = dbStorage.getWaFlows();
    const todayStr = new Date().toISOString().slice(0, 10);

    let runsToday = 0;
    let aiTokensToday = 0;
    let errorsToday = 0;
    let unmatchedToday = 0;

    for (const f of flows) {
      if (f.stats && f.stats.day === todayStr) {
        runsToday += f.stats.runsToday || 0;
        aiTokensToday += f.stats.aiTokensToday || 0;
        errorsToday += f.stats.errorsToday || 0;
        unmatchedToday += f.stats.unmatchedToday || 0;
      }
    }

    return {
      totalFlows: flows.length,
      publishedFlows: flows.filter((f) => f.published).length,
      runsToday,
      aiTokensToday,
      errorsToday,
      unmatchedToday,
    };
  }

  private static sanitizeNodes(nodes: WaFlowNode[]): WaFlowNode[] {
    if (!Array.isArray(nodes) || nodes.length > 80) {
      throw new Error('Um fluxo pode ter no máximo 80 blocos.');
    }
    return nodes.map((node, index) => {
      if (!node || typeof node !== 'object') throw new Error(`Bloco ${index} inválido.`);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(node.id)) throw new Error('ID de bloco inválido.');
      if (!NODE_TYPES.has(node.type)) throw new Error(`Tipo de bloco inválido: ${node.type}`);
      const x = Number(node.position?.x);
      const y = Number(node.position?.y);

      const d = node.data || {};

      return {
        id: node.id,
        type: node.type,
        position: {
          x: Number.isFinite(x) ? Math.max(-4000, Math.min(4000, x)) : 0,
          y: Number.isFinite(y) ? Math.max(-4000, Math.min(4000, y)) : 0,
        },
        data: {
          match: d.match === 'contains' || d.match === 'regex' ? d.match : 'any',
          keyword: String(d.keyword || '').slice(0, 200),
          event:
            d.event === 'deploy_fail' ||
            d.event === 'deploy_ok' ||
            d.event === 'app_down' ||
            d.event === 'backup'
              ? d.event
              : undefined,
          instance: d.instance ? String(d.instance).slice(0, 80) : undefined,
          recipient: d.recipient ? String(d.recipient).slice(0, 40) : undefined,
          text: String(d.text || '').slice(0, 2000),
          buttons: Array.isArray(d.buttons)
            ? d.buttons.slice(0, 3).map((b, i) => ({
                id: String(b?.id || `btn-${i}`).slice(0, 40),
                label: String(b?.label || '').slice(0, 24),
              }))
            : [],
          operator:
            d.operator === 'equals' ||
            d.operator === 'regex' ||
            d.operator === 'gt' ||
            d.operator === 'lt' ||
            d.operator === 'exists'
              ? d.operator
              : 'contains',
          source: d.source === 'var' ? 'var' : 'lastText',
          varName: d.varName ? String(d.varName).slice(0, 32) : undefined,
          value: String(d.value || '').slice(0, 200),
          // capture
          captureType:
            d.captureType === 'number' || d.captureType === 'phone' || d.captureType === 'email'
              ? d.captureType
              : 'text',
          saveLead: Boolean(d.saveLead),
          // agent
          provider: d.provider === 'openrouter' ? 'openrouter' : 'openai',
          model: d.model ? String(d.model).slice(0, 80) : undefined,
          systemPrompt: d.systemPrompt ? String(d.systemPrompt).slice(0, 4000) : undefined,
          maxTokens: Number.isFinite(d.maxTokens) ? Math.max(1, Math.min(1024, Number(d.maxTokens))) : 512,
          memoryTurns: Number.isFinite(d.memoryTurns) ? Math.max(1, Math.min(30, Number(d.memoryTurns))) : 12,
          fallbackText: d.fallbackText ? String(d.fallbackText).slice(0, 500) : undefined,
          // http
          httpMethod: d.httpMethod === 'POST' ? 'POST' : 'GET',
          httpUrl: d.httpUrl ? String(d.httpUrl).slice(0, 500) : undefined,
          httpHeaders: typeof d.httpHeaders === 'object' && d.httpHeaders ? d.httpHeaders : undefined,
          httpBody: d.httpBody ? String(d.httpBody).slice(0, 4000) : undefined,
          saveAs: d.saveAs ? String(d.saveAs).slice(0, 64) : undefined,
          // sql
          sqlQuery: d.sqlQuery ? String(d.sqlQuery).slice(0, 2000) : undefined,
          sqlParams: Array.isArray(d.sqlParams) ? d.sqlParams.slice(0, 10).map((p) => String(p).slice(0, 64)) : undefined,
          sqlMode: d.sqlMode === 'write' ? 'write' : 'read',
          sqlDatabaseId: d.sqlDatabaseId ? String(d.sqlDatabaseId).slice(0, 64) : undefined,
          // handoff
          notifyNumber: d.notifyNumber ? String(d.notifyNumber).slice(0, 40) : undefined,
          notifyMessage: d.notifyMessage ? String(d.notifyMessage).slice(0, 500) : undefined,
          resumeMinutes: Number.isFinite(d.resumeMinutes) ? Math.max(5, Math.min(1440, Number(d.resumeMinutes))) : 120,
          // delay
          delaySeconds: Number.isFinite(d.delaySeconds) ? Math.max(0, Math.min(10, Number(d.delaySeconds))) : 2,
        },
      };
    });
  }

  private static sanitizeEdges(edges: WaFlowEdge[]): WaFlowEdge[] {
    if (!Array.isArray(edges) || edges.length > 160) {
      throw new Error('Um fluxo pode ter no máximo 160 ligações.');
    }
    return edges.map((edge) => {
      if (!edge || typeof edge !== 'object') throw new Error('Ligação inválida.');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(edge.id)) throw new Error('ID de ligação inválido.');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(edge.source) || !/^[a-zA-Z0-9_-]{1,64}$/.test(edge.target)) {
        throw new Error('Ligação com origem ou destino inválido.');
      }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ? String(edge.sourceHandle).slice(0, 40) : undefined,
      };
    });
  }
}
