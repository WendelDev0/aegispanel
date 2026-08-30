import { Router, Request, Response } from 'express';
import { FirewallService } from '../services/firewall.service.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

export const firewallRouter = Router();

firewallRouter.use(authMiddleware);

/**
 * Reports whether rules can actually be enforced from here, so the UI can say
 * so instead of implying every listed rule is active on the host.
 */
firewallRouter.get('/status', async (req: Request, res: Response) => {
  res.json(await FirewallService.checkAvailability());
});

firewallRouter.get('/rules', (req: Request, res: Response) => {
  res.json(FirewallService.getRules());
});

firewallRouter.post('/rules', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { port, protocol, action, comment } = req.body;
    if (!port) {
      res.status(400).json({ error: 'Porta é obrigatória' });
      return;
    }

    const result = await FirewallService.addRule({
      port: parseInt(port),
      protocol: protocol || 'tcp',
      action: action || 'allow',
      comment: comment || 'Custom Rule',
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

firewallRouter.delete('/rules/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await FirewallService.deleteRule(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Regra não encontrada' });
      return;
    }
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
