import { dbStorage, AppRecord, DomainRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { PortService } from './port.service.js';
import { containerNameForApp, normalizeDomain } from '../utils/naming.js';

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
}

export class AppService {
  static getAll(): AppRecord[] {
    return dbStorage.getApps();
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
    const { githubToken, webhookSecret, ...rest } = app;
    return {
      ...rest,
      hasGithubToken: Boolean(githubToken),
      hasWebhookSecret: Boolean(webhookSecret),
    };
  }

  /** Returns the decrypted GitHub PAT, or undefined when none is stored. */
  static getGithubToken(app: AppRecord): string | undefined {
    if (!app.githubToken) return undefined;
    return EncryptionService.tryDecrypt(app.githubToken) ?? undefined;
  }

  static rotateWebhookSecret(appId: string): string {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('App não encontrado');
    app.webhookSecret = EncryptionService.generateToken(32);
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);
    return app.webhookSecret;
  }

  static async removeContainerByAppName(appName: string): Promise<void> {
    try {
      await dockerService.removeContainerByName(containerNameForApp(appName));
    } catch (err: any) {
      console.warn(`Não foi possível remover o contêiner antigo de "${appName}":`, err.message);
    }
  }

  static async createApp(dto: CreateAppDTO): Promise<AppRecord> {
    const id = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const containerName = containerNameForApp(dto.name);
    const internalPort = dto.internalPort || 3000;

    // Picking a free host port is bookkeeping the panel can do itself. Traffic
    // reaches the application through Caddy on the container's internal port,
    // so the host port only matters for direct IP:port access.
    const autoPort = !dto.port;
    const hostPort = await PortService.allocate(dto.port);
    const envRecord = dto.env || {};
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
      env: envRecord,
      domain: cleanDomain,
      // Every app gets a high-entropy webhook secret at creation. Without one
      // the webhook endpoint has nothing to verify and accepts any caller.
      webhookSecret: EncryptionService.generateToken(32),
      githubToken: dto.githubToken ? EncryptionService.encrypt(dto.githubToken) : undefined,
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

    await dockerService.startContainer(app.containerId);
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

    await dockerService.stopContainer(app.containerId);
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

    await dockerService.restartContainer(app.containerId);
    app.status = 'running';
    app.updatedAt = new Date().toISOString();
    return dbStorage.saveApp(app);
  }

  static async deleteApp(id: string): Promise<boolean> {
    const app = dbStorage.getAppById(id);
    if (!app) return false;

    if (app.containerId) {
      try {
        await dockerService.removeContainer(app.containerId, true);
      } catch (err) {
        console.error('Error removing app container:', err);
      }
    }
    // Also clear a container left behind by an earlier rename.
    await this.removeContainerByAppName(app.name);

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
