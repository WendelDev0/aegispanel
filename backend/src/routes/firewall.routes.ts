import { Router, Request, Response } from 'express';
import { FirewallService } from '../services/firewall.service.js';
import { authMiddleware } from './auth.routes.js';

export const firewallRouter = Router();

firewallRouter.use(authMiddleware);

firewallRouter.get('/rules', (req: Request, res: Response) => {
  res.json(FirewallService.getRules());
});

firewallRouter.post('/rules', async (req: Request, res: Response): Promise<void> => {
  try {
    const { port, protocol, action, comment } = req.body;
    if (!port) {
      res.status(400).json({ error: 'Porta é obrigatória' });
      return;
    }

    const rule = await FirewallService.addRule({
      port: parseInt(port),
      protocol: protocol || 'tcp',
      action: action || 'allow',
      comment: comment || 'Custom Rule',
    });

    res.status(201).json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

firewallRouter.delete('/rules/:id', async (req: Request, res: Response) => {
  const success = await FirewallService.deleteRule(req.params.id);
  res.json({ success });
});
