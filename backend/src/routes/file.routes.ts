import { Router, Request, Response } from 'express';
import express from 'express';
import fs from 'fs';
import { FileService } from '../services/file.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';

export const fileRouter = Router();

fileRouter.use(authMiddleware);

/** Uploads are the only endpoint that legitimately carries a large payload. */
const uploadBodyParser = express.json({ limit: '50mb' });

fileRouter.get('/list', (req: Request, res: Response): void => {
  try {
    res.json(FileService.listFiles((req.query.path as string) || ''));
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.get('/read', (req: Request, res: Response): void => {
  try {
    res.json({ content: FileService.readFile((req.query.path as string) || '') });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.post('/write', requireWrite, (req: Request, res: Response): void => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath) {
      res.status(400).json({ error: 'Caminho do arquivo é obrigatório' });
      return;
    }
    FileService.writeFile(relPath, content || '');
    res.json({ success: true });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.post('/upload', requireWrite, uploadBodyParser, (req: Request, res: Response): void => {
  try {
    const { path: relPath, base64 } = req.body;
    if (!relPath || !base64) {
      res.status(400).json({ error: 'Caminho e dados do arquivo em base64 são obrigatórios' });
      return;
    }
    FileService.uploadBase64(relPath, base64);
    res.json({ success: true });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.get('/download', (req: Request, res: Response): void => {
  try {
    const absPath = FileService.getSafeAbsolutePath((req.query.path as string) || '');
    if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
      return;
    }
    res.download(absPath);
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.post('/create-folder', requireWrite, (req: Request, res: Response): void => {
  try {
    const { path: relPath } = req.body;
    if (!relPath) {
      res.status(400).json({ error: 'Caminho da pasta é obrigatório' });
      return;
    }
    FileService.createDirectory(relPath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

fileRouter.delete('/delete', requireWrite, (req: Request, res: Response): void => {
  try {
    const relPath = (req.query.path as string) || '';
    if (!relPath) {
      res.status(400).json({ error: 'Caminho é obrigatório' });
      return;
    }
    res.json({ success: FileService.deleteItem(relPath) });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});
