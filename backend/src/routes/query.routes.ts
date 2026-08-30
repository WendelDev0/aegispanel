import { Router, Request, Response } from 'express';
import { QueryService } from '../services/query.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';

export const queryRouter = Router();

queryRouter.use(authMiddleware);

queryRouter.post('/execute', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { databaseId, sql } = req.body;
    if (!databaseId || !sql) {
      res.status(400).json({ error: 'Database e consulta SQL são obrigatórios' });
      return;
    }

    const result = await QueryService.executeQuery(databaseId, sql);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
