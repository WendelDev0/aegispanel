import { Router, Request, Response } from 'express';
import { AppService } from '../services/app.service.js';
import { dockerService } from '../services/docker.service.js';
import { CicdService } from '../services/cicd.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dbStorage } from '../db/storage.js';
import { authMiddleware } from './auth.routes.js';

export const appRouter = Router();

appRouter.use(authMiddleware);

appRouter.get('/', (req: Request, res: Response) => {
  const apps = AppService.getAll();
  res.json(apps);
});

appRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, sourceType, gitUrl, branch, imageName, port, internalPort, env, domain, githubToken } = req.body;
    if (!name || !port) {
      res.status(400).json({ error: 'Nome e porta são obrigatórios' });
      return;
    }

    const created = await AppService.createApp({
      name,
      sourceType: sourceType || 'image',
      gitUrl,
      branch,
      imageName,
      port: parseInt(port),
      internalPort: internalPort ? parseInt(internalPort) : undefined,
      env: env || {},
      domain,
    });

    if (githubToken) {
      created.githubToken = githubToken;
      dbStorage.saveApp(created);
    }

    // Create initial deployment record and attempt container spawn
    await CicdService.executeDeploy(created, {
      commitMessage: 'Initial Deployment Setup',
      triggeredBy: 'manual',
    }).catch(() => {});

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Full App Settings (Port, Name, Image, Branch, GitHub Token, etc.)
appRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { name, port, internalPort, imageName, gitUrl, branch, domain, githubToken } = req.body;
    if (name) app.name = name;
    if (port) app.port = parseInt(port);
    if (internalPort) app.internalPort = parseInt(internalPort);
    if (imageName) app.imageName = imageName;
    if (gitUrl) app.gitUrl = gitUrl;
    if (branch) app.branch = branch;
    if (githubToken !== undefined) app.githubToken = githubToken;
    if (domain !== undefined) app.domain = domain ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined;

    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // Redeploy with new port/image/token
    try {
      await CicdService.executeDeploy(app, {
        commitMessage: `Configurações atualizadas (Porta :${app.port})`,
        triggeredBy: 'manual',
      });
    } catch (deployErr: any) {
      console.warn('Redeploy warning after update:', deployErr.message);
    }

    await CaddyService.syncCaddyfile();
    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update App Environment Variables (.env)
appRouter.put('/:id/env', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { env } = req.body;
    app.env = env || {};
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // If restart requested
    if (req.query.redeploy === 'true') {
      await CicdService.executeDeploy(app, {
        commitMessage: 'Atualização de Variáveis de Ambiente (.env)',
        triggeredBy: 'manual',
      });
    }

    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update or add Domain / Subdomain to App
appRouter.put('/:id/domain', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { domain } = req.body;
    app.domain = domain ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined;
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    await CaddyService.syncCaddyfile();

    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual Trigger Deploy (CI/CD)
appRouter.post('/:id/deploy', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const deployment = await CicdService.executeDeploy(app, {
      commitMessage: req.body.message || 'Deploy manual disparado pelo painel',
      triggeredBy: 'manual',
    });

    res.json({ success: true, deployment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Deployments History
appRouter.get('/:id/deployments', (req: Request, res: Response) => {
  const deployments = dbStorage.getDeployments(req.params.id);
  res.json(deployments);
});

// Generate GitHub Actions Workflow YAML
appRouter.get('/:id/github-workflow', (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }

  const hostUrl = req.protocol + '://' + req.get('host');
  const yaml = CicdService.generateGitHubWorkflow(app, hostUrl);
  res.json({ yaml, branch: app.branch || 'main' });
});

appRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const updated = await AppService.startApp(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const updated = await AppService.stopApp(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const updated = await AppService.restartApp(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const app = AppService.getAll().find(a => a.id === req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    // Try container logs if container exists
    if (app.containerId) {
      try {
        const logs = await dockerService.getLogs(app.containerId, 100);
        if (logs && !logs.startsWith('Logs unavailable')) {
          res.json({ logs });
          return;
        }
      } catch {
        // fallback
      }
    }

    // Fallback: Return build and deployment logs
    const deployments = dbStorage.getDeployments(app.id);
    if (deployments.length > 0 && deployments[0].buildLogs) {
      let logMsg = `📋 [Logs de Build do CI/CD - Status: ${deployments[0].status.toUpperCase()}]:\n\n`;
      logMsg += deployments[0].buildLogs;
      if (!app.containerId) {
        logMsg += '\n💡 Dica: Inicie o Docker Desktop no seu Windows para que o contêiner suba e exiba os logs de execução da aplicação.';
      }
      res.json({ logs: logMsg });
      return;
    }

    res.json({ logs: 'Aguardando inicialização do container ou primeiro disparo de deploy...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await AppService.deleteApp(req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
