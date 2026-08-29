import { Router, Request, Response } from 'express';
import { BackupService } from '../services/backup.service.js';
import { authMiddleware } from './auth.routes.js';

export const backupRouter = Router();

backupRouter.use(authMiddleware);

backupRouter.get('/', (req: Request, res: Response) => {
  res.json(BackupService.getAll());
});

backupRouter.post('/database/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const backup = await BackupService.createDatabaseBackup(req.params.id);
    res.status(201).json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

backupRouter.get('/download/:filename', (req: Request, res: Response): void => {
  const filePath = BackupService.getBackupFilePath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ error: 'Arquivo de backup não encontrado' });
    return;
  }
  res.download(filePath);
});

backupRouter.delete('/:id', async (req: Request, res: Response) => {
  const success = await BackupService.deleteBackup(req.params.id);
  res.json({ success });
});
