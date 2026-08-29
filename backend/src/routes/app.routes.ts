import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppService } from '../services/app.service.js';
import { dockerService } from '../services/docker.service.js';
import { CicdService } from '../services/cicd.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { authMiddleware } from './auth.routes.js';

export const appRouter = Router();

appRouter.use(authMiddleware);

appRouter.get('/', (req: Request, res: Response) => {
  const apps = AppService.getAll();
  res.json(apps);
});

// Pre-Deploy Repo Inspector (Vercel Style Auto-Discovery)
appRouter.post('/inspect-repo', async (req: Request, res: Response): Promise<void> => {
  try {
    const { gitUrl, branch, githubToken } = req.body;
    if (!gitUrl) {
      res.status(400).json({ error: 'URL do repositório Git é obrigatória' });
      return;
    }

    const result = await CicdService.inspectRepository({
      gitUrl,
      branch,
      githubToken,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Falha ao inspecionar repositório: ' + err.message });
  }
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

    // Return created app immediately so frontend can open live streaming modal instantly
    res.status(201).json(created);

    // Trigger deploy in background asynchronously
    CicdService.executeDeploy(created, {
      commitMessage: 'Initial Deployment Setup',
      triggeredBy: 'manual',
    }).catch((err) => {
      console.error(`Initial deploy error for app ${created.name}:`, err.message);
    });
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

    // Sync domain port in storage and Caddy
    if (app.domain) {
      const cleanDom = app.domain.trim().toLowerCase();
      const existingDomain = dbStorage.getDomains().find(d => d.domain.toLowerCase().trim() === cleanDom);
      if (existingDomain) {
        existingDomain.targetPort = app.port;
        existingDomain.status = 'active';
        dbStorage.saveDomain(existingDomain);
      }
      await CaddyService.syncCaddyfile().catch(() => {});
    }

    // Redeploy with new port/image/token
    try {
      await CicdService.executeDeploy(app, {
        commitMessage: `Configurações atualizadas (Porta :${app.port})`,
        triggeredBy: 'manual',
      });
    } catch {
      // ignore
    }

    res.json(app);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manage .env Variables
appRouter.get('/:id/env', (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }
  res.json({ env: app.env || {} });
});

appRouter.put('/:id/env', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { env } = req.body;
    if (typeof env !== 'object' || env === null) {
      res.status(400).json({ error: 'O campo env deve ser um objeto chave-valor' });
      return;
    }

    app.env = env;
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // Trigger auto-redeploy to apply updated env vars into container
    try {
      await CicdService.executeDeploy(app, {
        commitMessage: 'Variáveis de ambiente (.env) atualizadas via AegisPanel',
        triggeredBy: 'manual',
      });
    } catch (deployErr: any) {
      console.warn('Auto-redeploy notice after env change:', deployErr.message);
    }

    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Domain for specific App
appRouter.put('/:id/domain', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { domain } = req.body;
    const cleanDomain = domain ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined;

    app.domain = cleanDomain;
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // Sync domains in Caddy
    await CaddyService.syncCaddyfile();

    res.json({ success: true, app });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List Deployments History
appRouter.get('/:id/deployments', (req: Request, res: Response): void => {
  const deployments = dbStorage.getDeployments(req.params.id);
  res.json(deployments);
});

// Trigger Manual Deploy
appRouter.post('/:id/deploy', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const deployment = await CicdService.executeDeploy(app, {
      commitMessage: req.body.commitMessage || 'Deploy manual disparado pelo painel',
      triggeredBy: 'manual',
    });

    res.json(deployment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1-Click Instant Rollback to previous deployment
appRouter.post('/:id/rollback/:deploymentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await CicdService.rollback(req.params.id, req.params.deploymentId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate GitHub Actions Workflow
appRouter.get('/:id/workflow', (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }

  const hostUrl = req.protocol + '://' + (req.get('host') || 'localhost:4000');
  const yaml = CicdService.generateGitHubWorkflow(app, hostUrl);
  res.json({ yaml });
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

// Application File Explorer: List files
appRouter.get('/:id/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const subPath = (req.query.subPath as string) || '';
    const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
    const targetDir = path.resolve(buildsDir, subPath);

    // Security check: path traversal prevention
    if (!targetDir.startsWith(path.resolve(buildsDir))) {
      res.status(403).json({ error: 'Acesso negado fora do diretório da aplicação' });
      return;
    }

    if (!fs.existsSync(targetDir)) {
      res.json({ currentPath: subPath, items: [] });
      return;
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = entries
      .filter(e => e.name !== '.git') // skip internal .git
      .map(entry => {
        const itemPath = path.join(targetDir, entry.name);
        const relativePath = path.relative(buildsDir, itemPath).replace(/\\/g, '/');
        let size = 0;
        let modifiedAt = new Date().toISOString();

        try {
          const stat = fs.statSync(itemPath);
          size = stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {
          // ignore
        }

        return {
          name: entry.name,
          path: relativePath,
          isDirectory: entry.isDirectory(),
          sizeBytes: size,
          modifiedAt,
          extension: entry.name.includes('.') ? entry.name.split('.').pop()?.toLowerCase() : '',
        };
      })
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ currentPath: subPath.replace(/\\/g, '/'), items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Application File Explorer: Read file content
appRouter.get('/:id/files/content', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const filePath = req.query.filePath as string;
    if (!filePath) {
      res.status(400).json({ error: 'Parâmetro filePath é obrigatório' });
      return;
    }

    const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
    const targetFile = path.resolve(buildsDir, filePath);

    if (!targetFile.startsWith(path.resolve(buildsDir))) {
      res.status(403).json({ error: 'Acesso negado fora do diretório da aplicação' });
      return;
    }

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
      return;
    }

    const content = fs.readFileSync(targetFile, 'utf-8');
    const stat = fs.statSync(targetFile);

    res.json({
      filename: path.basename(targetFile),
      path: filePath.replace(/\\/g, '/'),
      content,
      sizeBytes: stat.size,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Application File Explorer: Edit / Save file content
appRouter.put('/:id/files/content', async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { filePath, content } = req.body;
    if (!filePath || content === undefined) {
      res.status(400).json({ error: 'Parâmetros filePath e content são obrigatórios' });
      return;
    }

    const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
    const targetFile = path.resolve(buildsDir, filePath);

    if (!targetFile.startsWith(path.resolve(buildsDir))) {
      res.status(403).json({ error: 'Acesso negado fora do diretório da aplicação' });
      return;
    }

    fs.writeFileSync(targetFile, content, 'utf-8');
    res.json({ success: true, message: 'Arquivo salvo com sucesso!' });
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
