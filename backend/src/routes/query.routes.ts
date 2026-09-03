import { Router, Request, Response } from 'express';
import { QueryService } from '../services/query.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { executeQueryBodySchema } from '../validation/schemas.js';

export const queryRouter = Router();

queryRouter.use(authMiddleware);

queryRouter.post('/execute', requireWrite, validateBody(executeQueryBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { databaseId, sql } = req.body;
    const result = await QueryService.executeQuery(databaseId, sql);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
