import { Router, Request, Response } from 'express';
import { authMiddleware, requireWrite } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { emptyBodySchema, updateWaContactBodySchema } from '../validation/schemas.js';
import { WaContactStore } from '../utils/wa-contact.store.js';

export const waContactRouter = Router();

waContactRouter.use(authMiddleware);

/**
 * The contact roster.
 *
 * Nothing here ever returns a phone number: `WaContact` carries only the last
 * four digits and the salted hash, and the encrypted column is read solely by
 * the send path. An exported roster is therefore not a phone book.
 */
waContactRouter.get('/', (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

  res.json(
    WaContactStore.list({
      instance: req.query.instance ? String(req.query.instance) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      search: req.query.search ? String(req.query.search).slice(0, 80) : undefined,
      optedOut: req.query.optedOut === undefined ? undefined : req.query.optedOut === 'true',
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    })
  );
});

waContactRouter.get('/tags', (req: Request, res: Response): void => {
  res.json(WaContactStore.tagCounts(req.query.instance ? String(req.query.instance) : undefined));
});

waContactRouter.get('/:instance/:phoneHash', (req: Request, res: Response): void => {
  const contact = WaContactStore.get(req.params.instance, req.params.phoneHash);
  if (!contact) {
    res.status(404).json({ error: 'Contato não encontrado.' });
    return;
  }
  res.json(contact);
});

waContactRouter.get('/:instance/:phoneHash/history', (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
  res.json({
    messages: WaContactStore.history(
      req.params.instance,
      req.params.phoneHash,
      Number.isFinite(limit) ? limit : 30
    ),
  });
});

waContactRouter.put(
  '/:instance/:phoneHash',
  requireWrite,
  validateBody(updateWaContactBodySchema),
  (req: Request, res: Response): void => {
    const { instance, phoneHash } = req.params;
    if (!WaContactStore.get(instance, phoneHash)) {
      res.status(404).json({ error: 'Contato não encontrado.' });
      return;
    }

    if (req.body.attrs) WaContactStore.setAttrs(instance, phoneHash, req.body.attrs);
    if (req.body.tags) WaContactStore.setTags(instance, phoneHash, req.body.tags);
    if (req.body.optedOut !== undefined) {
      WaContactStore.setOptOut(instance, phoneHash, Boolean(req.body.optedOut));
    }

    res.json(WaContactStore.get(instance, phoneHash));
  }
);

waContactRouter.delete(
  '/:instance/:phoneHash',
  requireWrite,
  validateBody(emptyBodySchema),
  (req: Request, res: Response): void => {
    WaContactStore.remove(req.params.instance, req.params.phoneHash);
    res.json({ ok: true });
  }
);
