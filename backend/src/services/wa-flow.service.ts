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

const NODE_TYPES = new Set([
  'trigger_message',
  'trigger_event',
  'send_text',
  'menu',
  'wait_reply',
  'condition',
  'end',
]);

export class WaFlowService {
  static list(): WaFlowRecord[] {
    return dbStorage.getWaFlows();
  }

  static get(id: string): WaFlowRecord {
    const flow = dbStorage.getWaFlowById(id);
    if (!flow) throw new Error('Fluxo não encontrado');
    return flow;
  }

  static create(input: { name: string; nodes?: WaFlowNode[]; edges?: WaFlowEdge[] }): WaFlowRecord {
    const name = input.name.trim();
    if (!name) throw new Error('Nome do fluxo é obrigatório.');
    const now = new Date().toISOString();
    const flow: WaFlowRecord = {
      id: `waflow-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      name: name.slice(0, 80),
      published: false,
      nodes: this.sanitizeNodes(input.nodes || []),
      edges: this.sanitizeEdges(input.edges || []),
      createdAt: now,
      updatedAt: now,
    };
    return dbStorage.saveWaFlow(flow);
  }

  static update(
    id: string,
    patch: { name?: string; nodes?: WaFlowNode[]; edges?: WaFlowEdge[] }
  ): WaFlowRecord {
    const current = this.get(id);
    const updated: WaFlowRecord = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim().slice(0, 80) || current.name : current.name,
      nodes: patch.nodes ? this.sanitizeNodes(patch.nodes) : current.nodes,
      edges: patch.edges ? this.sanitizeEdges(patch.edges) : current.edges,
      updatedAt: new Date().toISOString(),
    };
    return dbStorage.saveWaFlow(updated);
  }

  static remove(id: string): void {
    this.get(id);
    dbStorage.removeWaFlow(id);
    WaSessionStore.clearFlow(id);
  }

  static evolutionCreds(): EvolutionCredentials | null {
    const cfg = dbStorage.getSettings().alertConfig;
    if (!cfg?.whatsappApiUrl || !cfg.whatsappApiKey || !cfg.whatsappInstance) return null;
    return {
      apiUrl: cfg.whatsappApiUrl,
      apiKey: cfg.whatsappApiKey,
      instance: cfg.whatsappInstance,
    };
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
    if (published && !creds) {
      throw new Error('Configure a Evolution API em Configurações antes de publicar.');
    }

    if (published) {
      const result = await evolutionSetWebhook(creds!, this.webhookUrl());
      if (!result.ok && result.skipped !== 'local_mode') {
        throw new Error(result.error || 'Não foi possível registrar o webhook na Evolution.');
      }
    } else if (!dbStorage.getWaFlows().some((f) => f.published && f.id !== id)) {
      if (creds) await evolutionClearWebhook(creds);
      WaSessionStore.clearFlow(id);
    }

    const updated: WaFlowRecord = {
      ...flow,
      published,
      updatedAt: new Date().toISOString(),
    };
    return dbStorage.saveWaFlow(updated);
  }

  static markRun(id: string): void {
    const flow = dbStorage.getWaFlowById(id);
    if (!flow) return;
    dbStorage.saveWaFlow({ ...flow, lastRunAt: new Date().toISOString() });
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
      return {
        id: node.id,
        type: node.type,
        position: {
          x: Number.isFinite(x) ? Math.max(-4000, Math.min(4000, x)) : 0,
          y: Number.isFinite(y) ? Math.max(-4000, Math.min(4000, y)) : 0,
        },
        data: {
          match: node.data?.match === 'contains' || node.data?.match === 'regex' ? node.data.match : 'any',
          keyword: String(node.data?.keyword || '').slice(0, 200),
          event:
            node.data?.event === 'deploy_fail' ||
            node.data?.event === 'deploy_ok' ||
            node.data?.event === 'app_down' ||
            node.data?.event === 'backup'
              ? node.data.event
              : undefined,
          text: String(node.data?.text || '').slice(0, 2000),
          buttons: Array.isArray(node.data?.buttons)
            ? node.data.buttons.slice(0, 3).map((b, i) => ({
                id: String(b?.id || `btn-${i}`).slice(0, 40),
                label: String(b?.label || '').slice(0, 24),
              }))
            : [],
          operator: node.data?.operator === 'equals' ? 'equals' : 'contains',
          value: String(node.data?.value || '').slice(0, 200),
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
