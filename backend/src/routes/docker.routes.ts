import { Router, Request, Response } from 'express';
import { dockerService } from '../services/docker.service.js';
import { authMiddleware } from './auth.routes.js';

export const dockerRouter = Router();

dockerRouter.use(authMiddleware);

dockerRouter.get('/status', async (req: Request, res: Response) => {
  const isAvailable = await dockerService.testConnection();
  res.json({ isAvailable });
});

dockerRouter.get('/containers', async (req: Request, res: Response) => {
  try {
    const containers = await dockerService.listContainers(true);
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

dockerRouter.get('/containers/:id/logs', async (req: Request, res: Response) => {
  try {
    const tail = req.query.tail ? parseInt(req.query.tail as string) : 100;
    const logs = await dockerService.getLogs(req.params.id, tail);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/start', async (req: Request, res: Response) => {
  try {
    await dockerService.startContainer(req.params.id);
    res.json({ success: true, message: 'Container iniciado com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/stop', async (req: Request, res: Response) => {
  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ success: true, message: 'Container parado com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.post('/containers/:id/restart', async (req: Request, res: Response) => {
  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ success: true, message: 'Container reiniciado com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

dockerRouter.delete('/containers/:id', async (req: Request, res: Response) => {
  try {
    await dockerService.removeContainer(req.params.id, true);
    res.json({ success: true, message: 'Container removido com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
