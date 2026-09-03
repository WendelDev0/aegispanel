import { Router, Request, Response } from 'express';
import { BackupService } from '../services/backup.service.js';
import { authMiddleware, requireWrite, requireAdmin, AuthRequest, clientIp } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { emptyBodySchema } from '../validation/schemas.js';
import { AuditStore } from '../utils/audit.store.js';

export const backupRouter = Router();

backupRouter.use(authMiddleware);

backupRouter.get('/', (req: Request, res: Response) => {
  res.json(BackupService.getAll());
});

backupRouter.post('/database/:id', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const backup = await BackupService.createDatabaseBackup(req.params.id);
    res.status(201).json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

backupRouter.post('/panel', requireAdmin, validateBody(emptyBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const backup = await BackupService.createPanelStateBackup();
    res.status(201).json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

backupRouter.post('/:id/restore', requireAdmin, validateBody(emptyBodySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const backup = BackupService.getAll().find((b) => b.id === req.params.id);
    if (backup && backup.targetType === 'full' && backup.targetId === 'panel') {
      await BackupService.restorePanelStateBackup(req.params.id);
      AuditStore.append({
        actor: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : undefined,
        sid: req.user?.sid,
        ip: clientIp(req),
        action: 'backup.restore',
        outcome: 'success',
        target: { type: 'panel', id: backup.id, name: backup.filename },
      });
      res.json({ success: true, message: 'Estado do painel restaurado com sucesso a partir do backup.' });
      return;
    }
    await BackupService.restoreBackup(req.params.id);
    AuditStore.append({
      actor: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : undefined,
      sid: req.user?.sid,
      ip: clientIp(req),
      action: 'backup.restore',
      outcome: 'success',
      target: backup
        ? { type: 'database', id: backup.targetId, name: backup.targetName }
        : { type: 'backup', id: req.params.id },
    });
    res.json({ success: true, message: 'Banco de dados restaurado com sucesso a partir do backup.' });
  } catch (err: any) {
    AuditStore.append({
      actor: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : undefined,
      sid: req.user?.sid,
      ip: clientIp(req),
      action: 'backup.restore',
      outcome: 'failure',
      target: { type: 'backup', id: req.params.id },
      meta: { error: err.message },
    });
    res.status(500).json({ error: err.message });
  }
});

// A backup is a database dump, not just an application artifact. Only an
// administrator may download it or carry it outside the server.
backupRouter.get('/download/:filename', requireAdmin, (req: Request, res: Response): void => {
  const filePath = BackupService.getBackupFilePath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ error: 'Arquivo de backup não encontrado' });
    return;
  }
  res.download(filePath);
});

backupRouter.delete('/:id', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response) => {
  const success = await BackupService.deleteBackup(req.params.id);
  res.json({ success });
});
