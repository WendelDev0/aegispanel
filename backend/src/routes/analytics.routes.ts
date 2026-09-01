import { Router, Request, Response } from 'express';
import { AnalyticsService, Range } from '../services/analytics.service.js';
import { authMiddleware } from '../middleware/auth.js';

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

const RANGES: readonly Range[] = ['1h', '24h', '7d', '30d'];

function parseRange(raw: unknown): Range {
  const value = typeof raw === 'string' ? raw : '';
  return (RANGES as readonly string[]).includes(value) ? (value as Range) : '24h';
}

/**
 * Collection diagnostics.
 *
 * Registered before "/:appId" so the literal path is not swallowed by the
 * parameter route. It exists because the failure mode of this feature is
 * silence: when the panel shows no traffic there is no way, from the UI, to
 * tell an idle site from a collector that is not reading the log at all.
 */
analyticsRouter.get('/_status', (_req: Request, res: Response): void => {
  res.json(AnalyticsService.getStatus());
});

/** Panel-wide roll-up across every domain Caddy serves. */
analyticsRouter.get('/_overview', (req: Request, res: Response): void => {
  res.json(AnalyticsService.getOverview(parseRange(req.query.range)));
});

analyticsRouter.get('/:appId', (req: Request, res: Response): void => {
  try {
    res.json(AnalyticsService.getReport(req.params.appId, parseRange(req.query.range)));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});
