import { Router, Response } from 'express';
import { CronService } from '../services/cron.service.js';
import { dbStorage } from '../db/storage.js';
import { authMiddleware, requireAdmin, requireWrite, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createCronBodySchema, emptyBodySchema } from '../validation/schemas.js';

export const cronRouter = Router();

cronRouter.use(authMiddleware);

/**
 * A `shell` job runs an arbitrary command on the host, which is equivalent to
 * a root shell. Creating or running one is therefore admin-only, while backup
 * and webhook jobs stay available to developers.
 */
function canHandleShell(req: AuthRequest): boolean {
  return req.user?.role === 'admin';
}

cronRouter.get('/', (req: AuthRequest, res: Response) => {
  res.json(CronService.getAll());
});

cronRouter.post('/', requireWrite, validateBody(createCronBodySchema), (req: AuthRequest, res: Response): void => {
  try {
    const { name, schedule, type, command, webhookUrl } = req.body;

    if (type !== 'backup' && !canHandleShell(req)) {
      res.status(403).json({
        error: 'Somente administradores podem criar tarefas shell ou webhook, pois elas executam ações privilegiadas no servidor.',
      });
      return;
    }

    if (type === 'shell' && !command) {
      res.status(400).json({ error: 'Tarefas do tipo shell exigem um comando.' });
      return;
    }

    if (type === 'webhook' && !webhookUrl) {
      res.status(400).json({ error: 'Tarefas do tipo webhook exigem uma URL.' });
      return;
    }

    if (!CronService.isValidSchedule(schedule)) {
      res.status(400).json({ error: 'Expressão cron inválida. Formato esperado: "min hora dia mês dia-da-semana".' });
      return;
    }

    res.status(201).json(
      CronService.create({ name, schedule, type, command, webhookUrl, enabled: true })
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.post('/:id/run', requireWrite, validateBody(emptyBodySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const job = dbStorage.getCronJobs().find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Tarefa cron não encontrada' });
      return;
    }

    if (job.type !== 'backup' && !canHandleShell(req)) {
      res.status(403).json({ error: 'Somente administradores podem executar tarefas shell ou webhook.' });
      return;
    }

    res.json(await CronService.runNow(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.post('/:id/toggle', requireAdmin, validateBody(emptyBodySchema), (req: AuthRequest, res: Response) => {
  try {
    res.json(CronService.toggle(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

cronRouter.delete('/:id', requireAdmin, validateBody(emptyBodySchema), (req: AuthRequest, res: Response) => {
  res.json({ success: CronService.delete(req.params.id) });
});
