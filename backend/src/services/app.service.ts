import os from 'os';
import type Docker from 'dockerode';
import { dbStorage, AppRecord, DomainRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { PortService } from './port.service.js';
import { NodeService, LOCAL_NODE_ID } from './node.service.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { containerNameForApp, normalizeDomain } from '../utils/naming.js';
import { CONFIG } from '../config.js';
import { AppLogStore } from '../utils/app-log.store.js';
import { normalizeHealthcheck, type HealthcheckConfig } from '../utils/health-probe.js';
import {
  DEFAULT_APP_LIMITS,
  DEFAULT_DATABASE_LIMITS,
  committedMemoryMb,
  normalizeLimits,
  overcommitWarning,
  type OvercommitWarning,
  type ResourceLimits,
} from '../utils/resource-limits.js';

export { containerNameForApp, normalizeDomain };

export interface CreateAppDTO {
  name: string;
  sourceType: 'git' | 'dockerfile' | 'image';
  gitUrl?: string;
  branch?: string;
  imageName?: string;
  /** Omit to have a free host port assigned automatically. */
  port?: number;
  internalPort?: number;
  env?: Record<string, string>;
  domain?: string;
  githubToken?: string;
  autoDeploy?: boolean;
  deployBranch?: string;
  /** Target node for deploy. Absent = local panel machine. */
  nodeId?: string;
  /** Omit to inherit settings.defaultAppLimits. */
  limits?: ResourceLimits;
  /** Opting in also enables Docker's in-container probe. */
  healthcheck?: HealthcheckConfig;
}

export interface AppMetricsSnapshot {
  appId: string;
  appName: string;
  status: AppRecord['status'];
  available: boolean;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  retainedLogBytes: number;
}

export class AppService {
  /**
   * The ceiling this app runs under.
   *
   * Resolved at container-creation time, never stored resolved: an operator who
   * raises the global default expects apps that never set their own limit to
   * follow it on the next deploy, not to stay pinned to whatever the default
   * happened to be the day they were created.
   */
  static resolveLimits(app: Pick<AppRecord, 'limits'>): ResourceLimits {
    const fallback = normalizeLimits(dbStorage.getSettings().defaultAppLimits, DEFAULT_APP_LIMITS);
    return app.limits ? normalizeLimits(app.limits, fallback) : fallback;
  }

  /**
   * Memory promised across every managed workload versus the host's RAM.
   *
   * Databases count too: they are the largest ceilings on most installations,
   * so a total that ignored them would reassure the operator wrongly.
   */
  static overcommitStatus(): OvercommitWarning | null {
    const appLimits = dbStorage.getApps().map((app) => this.resolveLimits(app));
    const dbLimits = dbStorage.getDatabases().map((db) => {
      const fallback = normalizeLimits(
        dbStorage.getSettings().defaultDatabaseLimits,
        DEFAULT_DATABASE_LIMITS
      );
      return db.limits ? normalizeLimits(db.limits, fallback) : fallback;
    });

    return overcommitWarning(
      committedMemoryMb([...appLimits, ...dbLimits]),
      os.totalmem() / 1024 / 1024
    );
  }

  /**
   * Docker's in-container healthcheck for an app, when it opted in.
   *
   * Returns undefined by default. The probe runs inside the container and needs
   * wget or curl there; a distroless, scratch or slim image has neither, so a
   * default healthcheck would mark those apps unhealthy — and with automatic
   * rollback reading that signal, it would roll back deploys that worked. The
   * panel probes from outside instead (HealthService), which works for any
   * image; this is the extra signal for operators who want it in `docker ps`.
   */
  static dockerHealthcheck(
    app: Pick<AppRecord, 'healthcheck' | 'internalPort'>
  ): { config: HealthcheckConfig; internalPort: number } | undefined {
    if (!app.healthcheck) return undefined;
    return {
      config: normalizeHealthcheck(app.healthcheck),
      internalPort: app.internalPort || 3000,
    };
  }

  static validateEnv(env: unknown): Record<string, string> {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      throw new Error('O campo env deve ser um objeto chave-valor.');
    }

    const entries = Object.entries(env as Record<string, unknown>);
    if (entries.length > 200) throw new Error('Uma aplicação pode ter no máximo 200 variáveis de ambiente.');

    const result: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key)) {
        throw new Error(`Nome de variável inválido: ${key}`);
      }
      if (typeof value !== 'string' || value.length > 64 * 1024) {
        throw new Error(`Valor inválido ou grande demais para a variável ${key}.`);
      }
      result[key] = value;
    }
    return result;
  }

  static getAll(): AppRecord[] {
    return dbStorage.getApps();
  }

  static async getMetrics(appId: string): Promise<AppMetricsSnapshot> {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('App não encontrado');
    const retainedLogBytes = AppLogStore.size(appId);
    const empty = {
      appId: app.id,
      appName: app.name,
      status: app.status,
      available: false,
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryLimitBytes: 0,
      memoryPercent: 0,
      retainedLogBytes,
    };
    if (!app.containerId) return empty;

    const client = await this.dockerForApp(app);
    const stats = await dockerService.getContainerStats(app.containerId, client);
    return {
      ...empty,
      available: app.status === 'running',
      ...stats,
      retainedLogBytes,
    };
  }

  static async listMetrics(): Promise<AppMetricsSnapshot[]> {
    const snapshots: AppMetricsSnapshot[] = [];
    for (const app of dbStorage.getApps()) {
      try {
        snapshots.push(await this.getMetrics(app.id));
      } catch {
        snapshots.push({
          appId: app.id,
          appName: app.name,
          status: app.status,
          available: false,
          cpuPercent: 0,
          memoryUsedBytes: 0,
          memoryLimitBytes: 0,
          memoryPercent: 0,
          retainedLogBytes: AppLogStore.size(app.id),
        });
      }
    }
    return snapshots;
  }

  /**
   * Strips credentials before an app record leaves the API.
   * The GitHub token and the webhook secret are write-only: they are set
   * through dedicated endpoints and never echoed back in a list response.
   */
  static toPublic(app: AppRecord): Omit<AppRecord, 'githubToken' | 'webhookSecret'> & {
    hasGithubToken: boolean;
    hasWebhookSecret: boolean;
  } {
    const { githubToken, webhookSecret, env, ...rest } = app;
    const maskedEnv = Object.fromEntries(Object.keys(env || {}).map((key) => [key, '••••••••']));
    return {
      ...rest,
      env: maskedEnv,
      hasGithubToken: Boolean(githubToken),
      hasWebhookSecret: Boolean(webhookSecret),
    };
  }

  /** Returns the decrypted GitHub PAT, or undefined when none is stored. */
  static getGithubToken(app: AppRecord): string | undefined {
    if (!app.githubToken) return undefined;
    return EncryptionService.tryDecrypt(app.githubToken) ?? undefined;
  }

  /** Reads a webhook secret while supporting legacy plaintext records. */
  static getWebhookSecret(app: AppRecord): string | undefined {
    if (!app.webhookSecret) return undefined;
    if (EncryptionService.isEncrypted(app.webhookSecret)) {
      return EncryptionService.tryDecrypt(app.webhookSecret) ?? undefined;
    }
    return app.webhookSecret;
  }

  static rotateWebhookSecret(appId: string): string {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('App não encontrado');
    const rawSecret = EncryptionService.generateToken(32);
    app.webhookSecret = EncryptionService.encrypt(rawSecret);
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);
    return rawSecret;
  }

  /** Docker client for the app's target node; undefined means local singleton. */
  private static async dockerForApp(app: Pick<AppRecord, 'nodeId'>): Promise<Docker | undefined> {
    const nodeId = app.nodeId || LOCAL_NODE_ID;
    if (!isRemoteTarget(nodeId, NodeService.getById(nodeId))) return undefined;
    return NodeService.getClient(nodeId);
  }

  static async removeContainerByAppName(appName: string, client?: Docker): Promise<void> {
    try {
      await dockerService.removeContainerByName(containerNameForApp(appName), true, client);
    } catch (err: any) {
      console.warn(`Não foi possível remover o contêiner antigo de "${appName}":`, err.message);
    }
  }

  static async createApp(dto: CreateAppDTO): Promise<AppRecord> {
    const id = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const containerName = containerNameForApp(dto.name);
    const internalPort = dto.internalPort || 3000;
    const nodeId = dto.nodeId || undefined;

    // Refuse a missing / offline node at create time (same gate as deploy).
    if (nodeId && nodeId !== LOCAL_NODE_ID) {
      await NodeService.assertDeployTarget({
        name: dto.name,
        nodeId,
        sourceType: dto.sourceType,
      });
    }

    const isRemote = isRemoteTarget(nodeId, nodeId ? NodeService.getById(nodeId) : null);
    const dockerClient = isRemote && nodeId ? await NodeService.getClient(nodeId) : undefined;
    const portOpts = isRemote
      ? { client: dockerClient, nodeId: nodeId || LOCAL_NODE_ID }
      : { nodeId: LOCAL_NODE_ID };

    // Picking a free host port is bookkeeping the panel can do itself. Traffic
    // reaches the application through Caddy on the container's internal port,
    // so the host port only matters for direct IP:port access.
    const autoPort = !dto.port;
    const hostPort = await PortService.allocate(dto.port, undefined, portOpts);
    const envRecord = this.validateEnv(dto.env || {});
    const envList = Object.entries(envRecord).map(([k, v]) => `${k}=${v}`);

    const image = dto.imageName || 'node:20-alpine';
    let containerId: string | undefined;
    let status: AppRecord['status'] = 'stopped';

    const ports: { [intPort: string]: number } = { [`${internalPort}/tcp`]: hostPort };
    const cleanDomain = normalizeDomain(dto.domain);

    try {
      containerId = await dockerService.createAndStartContainer({
        name: containerName,
        image,
        env: envList,
        ports,
        bindIp: isRemote ? '0.0.0.0' : CONFIG.APP_BIND_IP,
        limits: this.resolveLimits({ limits: dto.limits }),
        healthcheck: this.dockerHealthcheck({ healthcheck: dto.healthcheck, internalPort }),
        client: dockerClient,
        joinPanelNetwork: !isRemote,
        labels: {
          'aegis.type': 'app',
          'aegis.app.name': dto.name,
          'aegis.app.domain': cleanDomain || '',
        },
      });
      status = 'running';
    } catch (err) {
      console.error('Could not start app container directly:', err);
      status = 'stopped';
    }

    const record: AppRecord = {
      id,
      name: dto.name,
      sourceType: dto.sourceType,
      gitUrl: dto.gitUrl,
      branch: dto.branch || 'main',
      imageName: dto.imageName || image,
      containerId,
      port: hostPort,
      internalPort,
      autoPort,
      // Stored only when the user set one. Left absent, the app follows the
      // global default as it changes.
      limits: dto.limits ? normalizeLimits(dto.limits) : undefined,
      healthcheck: dto.healthcheck ? normalizeHealthcheck(dto.healthcheck) : undefined,
      env: envRecord,
      domain: cleanDomain,
      // Every app gets a high-entropy webhook secret at creation. Without one
      // the webhook endpoint has nothing to verify and accepts any caller.
      webhookSecret: EncryptionService.encrypt(EncryptionService.generateToken(32)),
      githubToken: dto.githubToken ? EncryptionService.encrypt(dto.githubToken) : undefined,
      autoDeploy: dto.autoDeploy ?? true,
      deployBranch: dto.deployBranch || dto.branch || 'main',
      nodeId,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = dbStorage.saveApp(record);

    if (cleanDomain) {
      const existingDomain = dbStorage.getDomains().find((d) => d.domain === cleanDomain);
      if (!existingDomain) {
        const domRecord: DomainRecord = {
          id: `dom-app-${id}`,
          domain: cleanDomain,
          targetPort: hostPort,
          targetContainer: dto.name,
          sslEnabled: true,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        dbStorage.saveDomain(domRecord);
      } else {
        existingDomain.targetPort = hostPort;
        dbStorage.saveDomain(existingDomain);
      }
      await CaddyService.syncCaddyfile();
    }

    return saved;
  }

  static async startApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App não encontrado');
    if (!app.containerId) throw new Error('Este app ainda não possui contêiner. Faça um deploy primeiro.');

    const client = await this.dockerForApp(app);
    await dockerService.startContainer(app.containerId, client);
    app.status = 'running';
    app.updatedAt = new Date().toISOString();
    const updated = dbStorage.saveApp(app);
    await CaddyService.syncCaddyfile();
    return updated;
  }

  static async stopApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App não encontrado');
    if (!app.containerId) throw new Error('Este app ainda não possui contêiner.');

    const client = await this.dockerForApp(app);
    await dockerService.stopContainer(app.containerId, client);
    app.status = 'stopped';
    app.updatedAt = new Date().toISOString();
    const updated = dbStorage.saveApp(app);
    await CaddyService.syncCaddyfile();
    return updated;
  }

  static async restartApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App não encontrado');
    if (!app.containerId) throw new Error('Este app ainda não possui contêiner.');

    const client = await this.dockerForApp(app);
    await dockerService.restartContainer(app.containerId, client);
    app.status = 'running';
    app.updatedAt = new Date().toISOString();
    return dbStorage.saveApp(app);
  }

  static async deleteApp(id: string): Promise<boolean> {
    const app = dbStorage.getAppById(id);
    if (!app) return false;

    const client = await this.dockerForApp(app).catch(() => undefined);

    if (app.containerId) {
      try {
        await dockerService.removeContainer(app.containerId, true, false, client);
      } catch (err) {
        console.error('Error removing app container:', err);
      }
    }
    // Also clear a container left behind by an earlier rename.
    await this.removeContainerByAppName(app.name, client);

    if (app.domain) {
      const existingDom = dbStorage.getDomains().find((d) => d.domain === app.domain);
      if (existingDom) {
        dbStorage.removeDomain(existingDom.id);
      }
    }

    const removed = dbStorage.removeApp(id);
    await CaddyService.syncCaddyfile();
    return removed;
  }
}
