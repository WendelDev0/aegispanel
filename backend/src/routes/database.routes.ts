import { Router, Request, Response } from 'express';
import { DatabaseService } from '../services/database.service.js';
import { CONFIG } from '../config.js';
import { authMiddleware, requireAdmin, requireWrite } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createDatabaseBodySchema } from '../validation/schemas.js';

export const databaseRouter = Router();

databaseRouter.use(authMiddleware);

databaseRouter.get('/', (req: Request, res: Response) => {
  const databases = DatabaseService.getAll();
  res.json(databases);
});

databaseRouter.get('/supabase-hub', requireAdmin, async (req: Request, res: Response) => {
  try {
    const hub = await DatabaseService.getSupabaseHub(CONFIG.SUPABASE_PUBLIC_HOST);
    res.json(hub || { installed: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper endpoint to generate cryptographic credentials on demand
// Reveals the stored credentials for one database. Separate from the list
// endpoint so plaintext passwords are only sent when explicitly requested.
databaseRouter.get('/:id/credentials', requireWrite, (req: Request, res: Response): void => {
  try {
    res.json(DatabaseService.getCredentials(req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

databaseRouter.get('/generate-credentials', requireWrite, (req: Request, res: Response) => {
  const type = (req.query.type as string) || 'postgres';
  const credentials = DatabaseService.getCredentialsSuggestion(type);
  res.json(credentials);
});

databaseRouter.post('/', requireWrite, validateBody(createDatabaseBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, port, dbUser, dbPassword, dbName, withGui } = req.body;

    // The host port is optional; omitting it assigns a free one.
    const created = await DatabaseService.createDatabase({
      name,
      type,
      port: port ? parseInt(String(port), 10) : undefined,
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

databaseRouter.post('/:id/start', requireWrite, async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.startDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.post('/:id/stop', requireWrite, async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.stopDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.post('/:id/restart', requireWrite, async (req: Request, res: Response) => {
  try {
    const updated = await DatabaseService.restartDatabase(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

databaseRouter.delete('/:id', requireWrite, async (req: Request, res: Response) => {
  try {
    const success = await DatabaseService.deleteDatabase(req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
