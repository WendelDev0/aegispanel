import { Router, Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics.service.js';
import { authMiddleware } from '../middleware/auth.js';

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

const RANGES = ['24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

analyticsRouter.get('/:appId', (req: Request, res: Response): void => {
  try {
    const raw = (req.query.range as string) || '24h';
    const range: Range = (RANGES as readonly string[]).includes(raw) ? (raw as Range) : '24h';
    res.json(AnalyticsService.getReport(req.params.appId, range));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});
