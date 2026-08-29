import { Router, Request, Response } from 'express';
import { AppService } from '../services/app.service.js';
import { dockerService } from '../services/docker.service.js';
import { CicdService } from '../services/cicd.service.js';
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
    const { name, sourceType, gitUrl, branch, imageName, port, internalPort, env, domain } = req.body;
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

    // Create initial deployment record
    await CicdService.executeDeploy(created, {
      commitMessage: 'Initial Deployment Setup',
      triggeredBy: 'manual',
    }).catch(() => {});

    res.status(201).json(created);
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
    if (!app || !app.containerId) {
      res.json({ logs: 'Nenhum container ativo associado a este app.' });
      return;
    }
    const logs = await dockerService.getLogs(app.containerId, 100);
    res.json({ logs });
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
