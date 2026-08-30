import { Router, Request, Response } from 'express';
import { dbStorage, ServerNode } from '../db/storage.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

export const nodeRouter = Router();

nodeRouter.use(authMiddleware);

nodeRouter.get('/', (req: Request, res: Response) => {
  res.json(dbStorage.getServerNodes());
});

nodeRouter.post('/', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, hostIp, location } = req.body;
    if (!name || !hostIp) {
      res.status(400).json({ error: 'Nome e IP do servidor são obrigatórios' });
      return;
    }

    const id = `node-${Date.now().toString(36)}`;
    const newNode: ServerNode = {
      id,
      name,
      type: type || 'vps',
      hostIp,
      isCurrent: false,
      status: 'online',
      location: location || 'Nuvem',
    };

    const saved = dbStorage.saveServerNode(newNode);
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

nodeRouter.post('/select/:id', (req: Request, res: Response): void => {
  const nodes = dbStorage.getServerNodes();
  const target = nodes.find(n => n.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Servidor não encontrado' });
    return;
  }

  nodes.forEach(n => {
    n.isCurrent = (n.id === target.id);
    dbStorage.saveServerNode(n);
  });

  dbStorage.updateSettings({ serverName: target.name });

  res.json({ success: true, activeNode: target });
});

nodeRouter.delete('/:id', (req: Request, res: Response): void => {
  const success = dbStorage.removeServerNode(req.params.id);
  res.json({ success });
});
