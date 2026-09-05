import crypto from 'crypto';
import { dbStorage, type WaFlowEdge, type WaFlowNode, type WaFlowRecord } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { getPublicBaseUrl } from '../utils/public-url.js';
import { localDayStamp } from '../utils/day-stamp.js';
import {
  evolutionClearWebhook,
  evolutionFetchInstances,
  evolutionInspectCompetitors,
  evolutionManagerUrl,
  evolutionOutboundBlocked,
  evolutionSetWebhook,
  type EvolutionCredentials,
  type EvolutionInstanceInfo,
} from '../utils/evolution.client.js';
import { assessBoundInstances } from '../utils/wa-publish-ready.js';
import {
  internalPanelBaseUrl,
  preferInternalUrl,
  suggestInternalEvolutionUrl,
  type InternalRouteSuggestion,
} from '../utils/wa-internal-route.js';
import { CONFIG } from '../config.js';
import { WaSessionStore } from '../utils/wa-session.store.js';
import { WaStatsBuffer } from '../utils/wa-stats.buffer.js';
import { dockerService } from './docker.service.js';
import { validateFlowGraph, type ValidationResult } from './wa-flow-validator.js';
import { WA_FLOW_TEMPLATES } from './wa-flow-templates.js';

export interface InternalRouteProbe {
  ok: boolean;
  suggestion?: InternalRouteSuggestion;
  panelBaseUrl?: string;
  disabled?: boolean;
  error?: string;
}

/**
 * Asks a container to fetch a URL, so "can Evolution reach the panel" is
 * answered by Evolution rather than inferred from network membership.
 *
 * Three probes because the image is not ours: Evolution ships Node, but a
 * future base image may only carry wget or curl. Each one prints the status
 * line on success and exits non-zero on a connection error.
 */
async function probeFromContainer(
  containerName: string,
  url: string
): Promise<{ ok: boolean; error?: string }> {
  const attempts: string[][] = [
    ['wget', '-q', '-T', '5', '-O', '-', url],
    ['curl', '-fsS', '--max-time', '5', url],
    [
      'node',
      '-e',
      'fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(2);console.log("ok")}).catch(e=>{console.error(e.message);process.exit(1)})',
      url,
    ],
  ];

  let lastError = 'nenhum wget, curl ou node disponível no container';
  for (const cmd of attempts) {
    try {
      const result = await dockerService.execInContainer(containerName, cmd, { timeoutMs: 8000 });
      if (result.exitCode === 0) return { ok: true };
      const detail = (result.stderr || result.stdout || '').trim();
      // A missing binary is not a verdict on the network; try the next probe.
      if (/not found|no such file|executable file not found/i.test(detail)) {
        lastError = detail.slice(0, 200);
        continue;
      }
      return { ok: false, error: detail.slice(0, 200) || `saída ${result.exitCode}` };
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 200);
    }
  }
  return { ok: false, error: lastError };
}

/** Rides along with the buffered counters; flushed in the same write. */
const lastRunAtPending = new Map<string, string>();

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
    // Read-only view: pending counters merged so the UI is not one flush behind.
    return dbStorage.getWaFlows().map((f) => this.withPendingStats(f));
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

  /**
   * The hostname a browser must use. The manager link is opened by the
   * operator, so it can never carry the container address that server-side
   * calls prefer.
   */
  static publicEvolutionApiUrl(): string | null {
    const settings = dbStorage.getSettings();
    return settings.evolution?.apiUrl || settings.alertConfig?.whatsappApiUrl || null;
  }

  static evolutionCreds(instanceName?: string): EvolutionCredentials | null {
    const settings = dbStorage.getSettings();
    const internal = settings.waFlowInternalRoute;
    const evo = settings.evolution;
    if (evo?.apiUrl && evo?.apiKey) {
      return {
        apiUrl: preferInternalUrl(evo.apiUrl, evo.internalApiUrl, internal?.enabled),
        apiKey: evo.apiKey,
        instance: instanceName || settings.alertConfig?.whatsappInstance || '',
      };
    }

    const cfg = settings.alertConfig;
    if (cfg?.whatsappApiUrl && cfg.whatsappApiKey) {
      return {
        apiUrl: preferInternalUrl(cfg.whatsappApiUrl, evo?.internalApiUrl, internal?.enabled),
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

  /**
   * Where Evolution posts inbound messages. When the verified internal route
   * is on, that is the panel's address on the Docker network — a bot reply no
   * longer waits on public DNS, and a certificate renewal cannot mute it.
   */
  static webhookBaseUrl(): string {
    const settings = dbStorage.getSettings();
    const internal = settings.waFlowInternalRoute;
    if (internal?.enabled && internal.panelBaseUrl) {
      return internal.panelBaseUrl.replace(/\/+$/, '');
    }

    const base = getPublicBaseUrl(settings);
    if (!base) {
      throw new Error('Configure o domínio do painel ou AEGIS_PUBLIC_BASE_URL antes de publicar.');
    }
    return base;
  }

  static webhookUrl(): string {
    return `${this.webhookBaseUrl()}/api/wa-flows/webhook?token=${encodeURIComponent(this.webhookSecret())}`;
  }

  /**
   * Checks both directions before anything is saved. Registering an internal
   * webhook that Evolution cannot reach produces no error anywhere — the
   * panel reports "publicado", Evolution posts into the void, and the bot is
   * silent. So the panel asks Evolution's own container to fetch /api/health
   * instead of assuming the network reaches.
   */
  static currentInternalRoute(): { enabled: boolean; panelBaseUrl?: string; evolutionUrl?: string; verifiedAt?: string } {
    const settings = dbStorage.getSettings();
    const route = settings.waFlowInternalRoute;
    return {
      enabled: Boolean(route?.enabled),
      panelBaseUrl: route?.panelBaseUrl,
      evolutionUrl: settings.evolution?.internalApiUrl,
      verifiedAt: route?.verifiedAt,
    };
  }

  static async probeInternalRoute(): Promise<InternalRouteProbe> {
    const settings = dbStorage.getSettings();
    const publicUrl = this.publicEvolutionApiUrl();
    const apiKey = settings.evolution?.apiKey || settings.alertConfig?.whatsappApiKey;

    if (!publicUrl || !apiKey) {
      return { ok: false, error: 'Configure a Evolution API em Configurações antes de testar a rota interna.' };
    }

    const suggestion = suggestInternalEvolutionUrl(publicUrl, dbStorage.getApps(), dbStorage.getServerNodes());
    if (!suggestion) {
      return {
        ok: false,
        error:
          'A Evolution não é uma aplicação deste painel (ou está em um nó remoto), então não há rota interna. ' +
          'O tráfego continua pelo domínio público.',
      };
    }

    const panelBaseUrl = internalPanelBaseUrl(CONFIG.BACKEND_CONTAINER, CONFIG.PORT);

    // Direction 1: this backend reaching Evolution by container name.
    const reach = await evolutionFetchInstances({ apiUrl: suggestion.url, apiKey });
    if (!reach.ok) {
      return {
        ok: false,
        suggestion,
        panelBaseUrl,
        error: `O painel não alcançou ${suggestion.upstream}: ${reach.error || 'sem resposta'}`,
      };
    }

    // Direction 2: Evolution reaching this backend by container name.
    const containerName = suggestion.upstream.split(':')[0];
    const back = await probeFromContainer(containerName, `${panelBaseUrl}/api/health`);
    if (!back.ok) {
      return {
        ok: false,
        suggestion,
        panelBaseUrl,
        error: `A Evolution não alcançou ${panelBaseUrl}: ${back.error}. O webhook continua no domínio público.`,
      };
    }

    return { ok: true, suggestion, panelBaseUrl };
  }

  /**
   * Turns the internal route on only against a fresh probe. Callers cannot
   * hand-write the addresses; a wrong one here is invisible until a customer
   * messages and gets nothing.
   */
  static async setInternalRoute(enabled: boolean): Promise<InternalRouteProbe> {
    if (!enabled) {
      dbStorage.updateSettings({ waFlowInternalRoute: { enabled: false } });
      return { ok: true, disabled: true };
    }

    const probe = await this.probeInternalRoute();
    if (!probe.ok || !probe.suggestion || !probe.panelBaseUrl) return probe;

    const settings = dbStorage.getSettings();
    const patch: Parameters<typeof dbStorage.updateSettings>[0] = {
      waFlowInternalRoute: {
        enabled: true,
        panelBaseUrl: probe.panelBaseUrl,
        verifiedAt: new Date().toISOString(),
      },
    };
    // Only touch `evolution` when it exists; writing the key as undefined
    // would drop credentials that live under alertConfig instead.
    if (settings.evolution) {
      patch.evolution = { ...settings.evolution, internalApiUrl: probe.suggestion.url };
    }
    dbStorage.updateSettings(patch);
    return probe;
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

      const readiness = await this.assessPublish(flow.instanceNames);
      if (!readiness.ok) {
        throw new Error(readiness.error);
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

  static async listLiveInstances(): Promise<{
    ok: boolean;
    instances: EvolutionInstanceInfo[];
    managerUrl: string | null;
    error?: string;
  }> {
    const creds = this.evolutionCreds();
    // Built from the public hostname on purpose: this link is clicked in a
    // browser, which cannot resolve a Docker container name.
    const publicUrl = this.publicEvolutionApiUrl();
    const managerUrl = publicUrl ? evolutionManagerUrl(publicUrl) : null;
    if (!creds || !creds.apiUrl) {
      return { ok: false, instances: [], managerUrl, error: 'Evolution API não configurada em Configurações.' };
    }
    const result = await evolutionFetchInstances(creds);
    if (!result.ok) {
      return { ok: false, instances: [], managerUrl, error: result.error };
    }

    const instances: EvolutionInstanceInfo[] = [];
    for (const inst of result.instances) {
      const competitors = await evolutionInspectCompetitors({ ...creds, instance: inst.name });
      instances.push({ ...inst, competitors });
    }
    return { ok: true, instances, managerUrl };
  }

  static async assessPublish(instanceNames: string[]): Promise<{ ok: boolean; error?: string; warnings: string[] }> {
    const skipLiveCheck = evolutionOutboundBlocked() || CONFIG.LOCAL_MODE;
    let live: EvolutionInstanceInfo[] = [];
    if (!skipLiveCheck) {
      const listed = await this.listLiveInstances();
      live = listed.instances;
    }
    return assessBoundInstances(instanceNames, live, { skipLiveCheck });
  }

  /**
   * Buffers the counter instead of writing through. panel_db.json is one
   * document rewritten in full on every mutation, so counting each inbound
   * message there rewrote the whole control plane per WhatsApp ping.
   *
   * `lastRunAt` rides along in the same flush; nothing here reads it between
   * flushes except the UI, which gets the pending value merged in.
   */
  static markRun(id: string, details?: { aiTokens?: number; error?: boolean }): void {
    const todayStr = localDayStamp();
    if (WaStatsBuffer.dayChanged(id, todayStr)) this.flushStats();

    WaStatsBuffer.bump(id, todayStr, {
      runs: 1,
      aiTokens: details?.aiTokens || 0,
      errors: details?.error ? 1 : 0,
    });
    lastRunAtPending.set(id, new Date().toISOString());

    if (WaStatsBuffer.isDue()) this.flushStats();
  }

  static recordUnmatched(instance: string): void {
    // Increment unmatchedToday on published flows matching this instance
    const want = instance.trim().toLowerCase();
    const flows = dbStorage.getWaFlows().filter(
      (f) =>
        f.published &&
        (f.instanceNames || []).some((name) => String(name).trim().toLowerCase() === want)
    );
    const todayStr = localDayStamp();
    for (const flow of flows) {
      if (WaStatsBuffer.dayChanged(flow.id, todayStr)) this.flushStats();
      WaStatsBuffer.bump(flow.id, todayStr, { unmatched: 1 });
    }
    if (WaStatsBuffer.isDue()) this.flushStats();
  }

  /**
   * Applies every buffered counter in one pass. Called on a timer, when the
   * buffer ages out, and at shutdown — the last one matters because a
   * self-update restarts the container and would otherwise lose the tail.
   */
  static flushStats(): void {
    if (!WaStatsBuffer.hasPending()) return;
    const drained = WaStatsBuffer.drain();

    for (const [flowId, entry] of drained) {
      const flow = dbStorage.getWaFlowById(flowId);
      // The flow may have been deleted while counts were pending.
      if (!flow) {
        lastRunAtPending.delete(flowId);
        continue;
      }

      const stats = flow.stats && flow.stats.day === entry.day
        ? { ...flow.stats }
        : { runsToday: 0, aiTokensToday: 0, errorsToday: 0, unmatchedToday: 0, day: entry.day };

      stats.runsToday += entry.delta.runs;
      stats.aiTokensToday += entry.delta.aiTokens;
      stats.errorsToday += entry.delta.errors;
      stats.unmatchedToday = (stats.unmatchedToday || 0) + entry.delta.unmatched;

      const lastRunAt = lastRunAtPending.get(flowId);
      lastRunAtPending.delete(flowId);

      dbStorage.saveWaFlow({
        ...flow,
        stats,
        lastRunAt: lastRunAt || flow.lastRunAt,
      });
    }
  }

  /**
   * Stored record plus whatever has not been flushed yet. Read-only view:
   * mutation paths use `get()` so a pending delta is never written twice.
   */
  static withPendingStats(flow: WaFlowRecord): WaFlowRecord {
    const entry = WaStatsBuffer.peek(flow.id);
    if (!entry) return flow;

    const base = flow.stats && flow.stats.day === entry.day
      ? flow.stats
      : { runsToday: 0, aiTokensToday: 0, errorsToday: 0, unmatchedToday: 0, day: entry.day };

    return {
      ...flow,
      stats: {
        day: entry.day,
        runsToday: base.runsToday + entry.delta.runs,
        aiTokensToday: base.aiTokensToday + entry.delta.aiTokens,
        errorsToday: base.errorsToday + entry.delta.errors,
        unmatchedToday: (base.unmatchedToday || 0) + entry.delta.unmatched,
      },
      lastRunAt: lastRunAtPending.get(flow.id) || flow.lastRunAt,
    };
  }

  static getAggregatedStats(): {
    totalFlows: number;
    publishedFlows: number;
    runsToday: number;
    aiTokensToday: number;
    errorsToday: number;
    unmatchedToday: number;
  } {
    const flows = dbStorage.getWaFlows().map((f) => this.withPendingStats(f));
    const todayStr = localDayStamp();

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
