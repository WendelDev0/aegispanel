import { Router, Request, Response } from 'express';
import { CronService } from '../services/cron.service.js';
import { authMiddleware } from './auth.routes.js';

export const cronRouter = Router();

cronRouter.use(authMiddleware);

cronRouter.get('/', (req: Request, res: Response) => {
  res.json(CronService.getAll());
});

cronRouter.post('/', (req: Request, res: Response): void => {
  try {
    const { name, schedule, type, command, webhookUrl } = req.body;
    if (!name || !schedule || !type) {
      res.status(400).json({ error: 'Nome, expressão cron e tipo são obrigatórios' });
      return;
    }

    const created = CronService.create({
      name,
      schedule,
      type,
      command,
      webhookUrl,
      enabled: true,
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const updated = await CronService.runNow(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.post('/:id/toggle', (req: Request, res: Response) => {
  try {
    const updated = CronService.toggle(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.delete('/:id', (req: Request, res: Response) => {
  const success = CronService.delete(req.params.id);
  res.json({ success });
});
