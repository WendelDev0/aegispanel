import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin, requireWrite } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  emptyBodySchema,
  publishWaFlowBodySchema,
  releaseHandoffBodySchema,
  simulateWaFlowBodySchema,
  upsertWaFlowBodySchema,
} from '../validation/schemas.js';
import { WaFlowService } from '../services/wa-flow.service.js';
import { HandoffManager, WaFlowEngine } from '../services/wa-flow-engine.js';
import { WaLogStore } from '../utils/wa-log.store.js';
import { WA_FLOW_TEMPLATES } from '../services/wa-flow-templates.js';

export const waFlowRouter = Router();

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function webhookToken(req: Request): string {
  const header = String(req.headers['x-aegis-wa-secret'] || req.headers.apikey || '');
  const query = typeof req.query.token === 'string' ? req.query.token : '';
  return header || query;
}

waFlowRouter.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const expected = WaFlowService.webhookSecret();
    const provided = webhookToken(req);
    if (!provided || !safeEqual(provided, expected)) {
      res.status(401).json({ error: 'Webhook recusado: segredo inválido.' });
      return;
    }
    const handled = await WaFlowEngine.handleInbound(req.body);
    res.json({ ok: true, handled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

waFlowRouter.use(authMiddleware);

waFlowRouter.get('/', (_req: Request, res: Response) => {
  res.json(WaFlowService.list());
});

waFlowRouter.get('/stats', (_req: Request, res: Response) => {
  res.json(WaFlowService.getAggregatedStats());
});

waFlowRouter.get('/templates', (_req: Request, res: Response) => {
  res.json(WA_FLOW_TEMPLATES);
});

waFlowRouter.get('/:id', (req: Request, res: Response): void => {
  try {
    res.json(WaFlowService.get(req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

waFlowRouter.post('/', requireWrite, validateBody(upsertWaFlowBodySchema), (req: Request, res: Response): void => {
  try {
    res.status(201).json(WaFlowService.create(req.body));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

waFlowRouter.put('/:id', requireWrite, validateBody(upsertWaFlowBodySchema), (req: Request, res: Response): void => {
  try {
    res.json(WaFlowService.update(req.params.id, req.body));
  } catch (err: any) {
    const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

waFlowRouter.post('/:id/clone', requireWrite, validateBody(emptyBodySchema), (req: Request, res: Response): void => {
  try {
    res.status(201).json(WaFlowService.clone(req.params.id));
  } catch (err: any) {
    const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

waFlowRouter.delete('/:id', requireWrite, validateBody(emptyBodySchema), (req: Request, res: Response): void => {
  try {
    WaFlowService.remove(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.message === 'Fluxo não encontrado' ? 404 : 400).json({ error: err.message });
  }
});

waFlowRouter.post(
  '/:id/validate',
  requireWrite,
  validateBody(emptyBodySchema),
  (req: Request, res: Response): void => {
    try {
      res.json(WaFlowService.validate(req.params.id));
    } catch (err: any) {
      const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

waFlowRouter.post(
  '/:id/publish',
  requireAdmin,
  validateBody(publishWaFlowBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await WaFlowService.publish(req.params.id, Boolean(req.body.published)));
    } catch (err: any) {
      const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

waFlowRouter.post(
  '/:id/simulate',
  requireWrite,
  validateBody(simulateWaFlowBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await WaFlowEngine.simulate(
        req.params.id,
        req.body.messages,
        req.body.initialVars || {}
      );
      res.json(result);
    } catch (err: any) {
      const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

waFlowRouter.get('/:id/logs', (req: Request, res: Response): void => {
  try {
    // Flow must exist
    WaFlowService.get(req.params.id);
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    res.json(WaLogStore.listTurns(req.params.id, { limit, cursor }));
  } catch (err: any) {
    const status = err.message === 'Fluxo não encontrado' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

waFlowRouter.post(
  '/:id/handoff/release',
  requireWrite,
  validateBody(releaseHandoffBodySchema),
  (req: Request, res: Response): void => {
    try {
      const released = HandoffManager.release(req.body.instance, req.body.phoneHash);
      res.json({ ok: true, released });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);
