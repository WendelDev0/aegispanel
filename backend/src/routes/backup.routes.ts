import { Router, Request, Response } from 'express';
import { BackupService } from '../services/backup.service.js';
import { authMiddleware, requireWrite, requireAdmin } from '../middleware/auth.js';

export const backupRouter = Router();

backupRouter.use(authMiddleware);

backupRouter.get('/', (req: Request, res: Response) => {
  res.json(BackupService.getAll());
});

backupRouter.post('/database/:id', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const backup = await BackupService.createDatabaseBackup(req.params.id);
    res.status(201).json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

backupRouter.post('/:id/restore', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    await BackupService.restoreBackup(req.params.id);
    res.json({ success: true, message: 'Banco de dados restaurado com sucesso a partir do backup.' });
  } catch (err: any) {
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

backupRouter.delete('/:id', requireWrite, async (req: Request, res: Response) => {
  const success = await BackupService.deleteBackup(req.params.id);
  res.json({ success });
});
