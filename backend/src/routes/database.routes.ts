import { Router, Request, Response } from 'express';
import { DatabaseService } from '../services/database.service.js';
import { authMiddleware } from './auth.routes.js';

export const databaseRouter = Router();

databaseRouter.use(authMiddleware);

databaseRouter.get('/', (req: Request, res: Response) => {
  const databases = DatabaseService.getAll();
  res.json(databases);
});

// Helper endpoint to generate cryptographic credentials on demand
databaseRouter.get('/generate-credentials', (req: Request, res: Response) => {
  const type = (req.query.type as string) || 'postgres';
  const credentials = DatabaseService.getCredentialsSuggestion(type);
  res.json(credentials);
});

databaseRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, port, dbUser, dbPassword, dbName, withGui } = req.body;
    if (!name || !type || !port) {
      res.status(400).json({ error: 'Nome, tipo e porta são obrigatórios' });
      return;
    }

    const created = await DatabaseService.createDatabase({
      name,
      type,
      port: parseInt(port),
      dbUser,
      dbPassword,
      dbName,
      withGui,
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.startDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.stopDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.restartDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await DatabaseService.deleteDatabase(req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
