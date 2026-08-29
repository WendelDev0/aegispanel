import { dbStorage, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';

export interface CreateAppDTO {
  name: string;
  sourceType: 'git' | 'dockerfile' | 'image';
  gitUrl?: string;
  branch?: string;
  imageName?: string;
  port: number;
  internalPort?: number;
  env?: Record<string, string>;
  domain?: string;
}

export class AppService {
  static getAll(): AppRecord[] {
    return dbStorage.getApps();
  }

  static async createApp(dto: CreateAppDTO): Promise<AppRecord> {
    const id = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const containerName = `aegis-app-${dto.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
    const internalPort = dto.internalPort || 3000;
    const envRecord = dto.env || {};
    const envList = Object.entries(envRecord).map(([k, v]) => `${k}=${v}`);

    let image = dto.imageName || 'node:20-alpine';
    let containerId: string | undefined;
    let status: AppRecord['status'] = 'stopped';

    const ports: { [intPort: string]: number } = {};
    ports[`${internalPort}/tcp`] = dto.port;

    try {
      containerId = await dockerService.createAndStartContainer({
        name: containerName,
        image,
        env: envList,
        ports,
        labels: {
          'aegis.type': 'app',
          'aegis.app.name': dto.name,
          'aegis.app.domain': dto.domain || '',
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
      port: dto.port,
      internalPort,
      env: envRecord,
      domain: dto.domain,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = dbStorage.saveApp(record);
    if (dto.domain) {
      await CaddyService.syncCaddyfile();
    }
    return saved;
  }

  static async startApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App not found');

    if (app.containerId) {
      await dockerService.startContainer(app.containerId);
      app.status = 'running';
      app.updatedAt = new Date().toISOString();
      const updated = dbStorage.saveApp(app);
      await CaddyService.syncCaddyfile();
      return updated;
    }
    throw new Error('No container for app');
  }

  static async stopApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App not found');

    if (app.containerId) {
      await dockerService.stopContainer(app.containerId);
      app.status = 'stopped';
      app.updatedAt = new Date().toISOString();
      const updated = dbStorage.saveApp(app);
      await CaddyService.syncCaddyfile();
      return updated;
    }
    throw new Error('No container for app');
  }

  static async restartApp(id: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(id);
    if (!app) throw new Error('App not found');

    if (app.containerId) {
      await dockerService.restartContainer(app.containerId);
      app.status = 'running';
      app.updatedAt = new Date().toISOString();
      return dbStorage.saveApp(app);
    }
    throw new Error('No container for app');
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

    const removed = dbStorage.removeApp(id);
    await CaddyService.syncCaddyfile();
    return removed;
  }
}
