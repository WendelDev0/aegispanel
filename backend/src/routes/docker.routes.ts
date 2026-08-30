import { Router, Request, Response } from 'express';
import { dockerService } from '../services/docker.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';

export const dockerRouter = Router();

dockerRouter.use(authMiddleware);

dockerRouter.get('/status', async (req: Request, res: Response) => {
  const isAvailable = await dockerService.testConnection();
  const connectionType = dockerService.getConnectionType();
  res.json({
    isAvailable,
    connectionType,
    platform: process.platform,
    message: isAvailable
      ? `Docker Engine conectado com sucesso (${connectionType})`
      : 'Docker Engine offline. No Windows, inicie o Docker Desktop. Na VPS Linux, o Docker roda 24h nativamente.',
  });
});

dockerRouter.post('/reconnect', requireWrite, async (req: Request, res: Response) => {
  const connected = await dockerService.detectAndConnect();
  res.json({
    success: connected,
    isAvailable: connected,
    connectionType: dockerService.getConnectionType(),
  });
});

dockerRouter.get('/containers', async (req: Request, res: Response) => {
  try {
    const all = req.query.all !== 'false';
    const containers = await dockerService.listContainers(all);
    res.json(containers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.get('/containers/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await dockerService.getContainerStats(req.params.id);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/start', requireWrite, async (req: Request, res: Response) => {
  try {
    await dockerService.startContainer(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/stop', requireWrite, async (req: Request, res: Response) => {
  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/restart', requireWrite, async (req: Request, res: Response) => {
  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.delete('/containers/:id', requireWrite, async (req: Request, res: Response) => {
  try {
    await dockerService.removeContainer(req.params.id, true);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.get('/containers/:id/logs', async (req: Request, res: Response) => {
  try {
    const tail = req.query.tail ? parseInt(req.query.tail as string) : 100;
    const logs = await dockerService.getLogs(req.params.id, tail);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
