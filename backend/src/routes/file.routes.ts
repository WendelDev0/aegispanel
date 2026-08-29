import { Router, Request, Response } from 'express';
import fs from 'fs';
import { FileService } from '../services/file.service.js';
import { authMiddleware } from './auth.routes.js';

export const fileRouter = Router();

fileRouter.use(authMiddleware);

fileRouter.get('/list', (req: Request, res: Response): void => {
  try {
    const relPath = (req.query.path as string) || '';
    const files = FileService.listFiles(relPath);
    res.json(files);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.get('/read', (req: Request, res: Response): void => {
  try {
    const relPath = (req.query.path as string) || '';
    const content = FileService.readFile(relPath);
    res.json({ content });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.post('/write', (req: Request, res: Response): void => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath) {
      res.status(400).json({ error: 'Caminho do arquivo é obrigatório' });
      return;
    }
    FileService.writeFile(relPath, content || '');
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.post('/upload', (req: Request, res: Response): void => {
  try {
    const { path: relPath, base64 } = req.body;
    if (!relPath || !base64) {
      res.status(400).json({ error: 'Caminho e dados do arquivo em base64 são obrigatórios' });
      return;
    }
    FileService.uploadBase64(relPath, base64);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.get('/download', (req: Request, res: Response): void => {
  try {
    const relPath = (req.query.path as string) || '';
    const absPath = FileService.getSafeAbsolutePath(relPath);
    if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
      return;
    }
    res.download(absPath);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.post('/create-folder', (req: Request, res: Response): void => {
  try {
    const { path: relPath } = req.body;
    if (!relPath) {
      res.status(400).json({ error: 'Caminho da pasta é obrigatório' });
      return;
    }
    FileService.createDirectory(relPath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

fileRouter.delete('/delete', (req: Request, res: Response): void => {
  try {
    const relPath = (req.query.path as string) || '';
    if (!relPath) {
      res.status(400).json({ error: 'Caminho é obrigatório' });
      return;
    }
    const success = FileService.deleteItem(relPath);
    res.json({ success });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
