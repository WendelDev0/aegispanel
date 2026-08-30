import { Router, Request, Response } from 'express';
import { dbStorage, DomainRecord } from '../db/storage.js';
import { CaddyService } from '../services/caddy.service.js';
import { DomainService } from '../services/domain.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';

export const domainRouter = Router();

domainRouter.use(authMiddleware);

domainRouter.get('/', (req: Request, res: Response) => {
  // Auto-sync domains from Apps into the unified Domains list
  const apps = dbStorage.getApps();
  const domains = dbStorage.getDomains();
  let changed = false;

  for (const app of apps) {
    if (app.domain) {
      const clean = app.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const exists = domains.find(d => d.domain === clean);
      if (!exists) {
        const newDom: DomainRecord = {
          id: `dom-app-${app.id}`,
          domain: clean,
          targetPort: app.port,
          targetContainer: app.name,
          sslEnabled: true,
          status: 'active',
          createdAt: app.createdAt || new Date().toISOString(),
        };
        dbStorage.saveDomain(newDom);
        changed = true;
      } else if (exists.targetPort !== app.port) {
        exists.targetPort = app.port;
        dbStorage.saveDomain(exists);
        changed = true;
      }
    }
  }

  if (changed) {
    CaddyService.syncCaddyfile().catch(() => {});
  }

  res.json(dbStorage.getDomains());
});

// Check DNS propagation for any domain
domainRouter.post('/check-dns', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { domain } = req.body;
    if (!domain) {
      res.status(400).json({ error: 'Domínio é obrigatório' });
      return;
    }

    const check = await DomainService.checkDnsPropagation(domain);
    res.json(check);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get SSL Certificate Details
domainRouter.get('/:id/ssl-status', async (req: Request, res: Response): Promise<void> => {
  try {
    const domain = dbStorage.getDomains().find(d => d.id === req.params.id);
    if (!domain) {
      res.status(404).json({ error: 'Domínio não encontrado' });
      return;
    }

    const ssl = await DomainService.getSslDetails(domain.domain);
    res.json(ssl);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Force Renew SSL
domainRouter.post('/:id/renew-ssl', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    await DomainService.renewSsl(req.params.id);
    res.json({ success: true, message: 'Certificado SSL renovado com sucesso via Caddy Proxy.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

domainRouter.post('/', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { domain, targetPort, targetContainer } = req.body;
    if (!domain || !targetPort) {
      res.status(400).json({ error: 'Domínio e porta de destino são obrigatórios' });
      return;
    }

    const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const id = `dom-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const record: DomainRecord = {
      id,
      domain: cleanDomain,
      targetPort: parseInt(targetPort),
      targetContainer,
      sslEnabled: true,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const saved = dbStorage.saveDomain(record);
    await CaddyService.syncCaddyfile();

    res.status(201).json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

domainRouter.delete('/:id', requireWrite, async (req: Request, res: Response) => {
  try {
    const domainToRemove = dbStorage.getDomains().find(d => d.id === req.params.id);
    const success = dbStorage.removeDomain(req.params.id);

    // If linked to an app, remove from app record as well
    if (domainToRemove) {
      const apps = dbStorage.getApps();
      for (const app of apps) {
        if (app.domain === domainToRemove.domain) {
          app.domain = undefined;
          dbStorage.saveApp(app);
        }
      }
    }

    await CaddyService.syncCaddyfile();
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
