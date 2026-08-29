import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SystemService } from '../services/system.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dockerService } from '../services/docker.service.js';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { authMiddleware } from './auth.routes.js';

export const systemRouter = Router();

systemRouter.use(authMiddleware);

systemRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await SystemService.getRealtimeStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/history', (req: Request, res: Response) => {
  const range = (req.query.range as string) || 'realtime';
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  res.json(SystemService.getHistoricalMetrics(range, startDate, endDate));
});

// Run Network Speedtest on Server
systemRouter.post('/speedtest', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await SystemService.runSpeedtest();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/processes', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const processes = await SystemService.getTopProcesses(limit);
    res.json(processes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const stats = await SystemService.getRealtimeStats();
    const dockerAvailable = await dockerService.testConnection();
    const containers = await dockerService.listContainers(true);
    const databases = dbStorage.getDatabases();
    const apps = dbStorage.getApps();
    const settings = dbStorage.getSettings();

    res.json({
      system: stats,
      docker: {
        isAvailable: dockerAvailable,
        totalContainers: containers.length,
        runningContainers: containers.filter(c => c.state === 'running').length,
      },
      counts: {
        apps: apps.length,
        runningApps: apps.filter(a => a.status === 'running').length,
        databases: databases.length,
        runningDatabases: databases.filter(d => d.status === 'running').length,
      },
      settings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/settings', (req: Request, res: Response) => {
  res.json(dbStorage.getSettings());
});

systemRouter.put('/settings', (req: Request, res: Response) => {
  const updated = dbStorage.updateSettings(req.body);
  res.json(updated);
});

// Export Full Panel State (Migration Bundle: Local ➔ Contabo VPS)
systemRouter.get('/export-state', (req: Request, res: Response): void => {
  try {
    const dbPath = path.join(CONFIG.DATA_DIR, 'panel_db.json');
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=aegispanel-migration-${Date.now()}.json`);
      res.send(data);
      return;
    }
    res.status(404).json({ error: 'Nenhum dado encontrado para exportação' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import Full Panel State (Restore on Contabo VPS)
systemRouter.post('/import-state', (req: Request, res: Response): void => {
  try {
    const stateData = req.body;
    if (!stateData || typeof stateData !== 'object') {
      res.status(400).json({ error: 'Formato de dados inválido' });
      return;
    }

    const dbPath = path.join(CONFIG.DATA_DIR, 'panel_db.json');
    fs.writeFileSync(dbPath, JSON.stringify(stateData, null, 2), 'utf-8');

    res.json({
      success: true,
      message: 'Estado completo importado com sucesso! Seus bancos, apps e configurações estão prontos.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Force Reset Caddy SSL & Proxy (Clears ACME cache and regenerates Caddyfile)
systemRouter.post('/caddy-reset', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Regenerate Caddyfile with correct email and all domains
    const caddyContent = await CaddyService.syncCaddyfile();

    // 2. Clear ACME cache via Docker exec
    try {
      const client = dockerService.getDockerClient();
      const caddyContainer = client.getContainer('aegis-caddy');
      const exec = await caddyContainer.exec({
        Cmd: ['sh', '-c', 'rm -rf /data/caddy/acme && caddy reload --config /etc/caddy/Caddyfile'],
        AttachStdout: true,
        AttachStderr: true,
      });
      await exec.start({});
    } catch (dockerErr: any) {
      console.warn('Caddy Docker reset notice:', dockerErr.message);
    }

    res.json({
      success: true,
      message: 'Cache ACME limpo e Caddyfile regenerado! O Let\'s Encrypt emitirá novos certificados SSL.',
      caddyfile: caddyContent,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
