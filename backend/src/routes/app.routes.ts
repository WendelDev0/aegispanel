import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppService } from '../services/app.service.js';
import { dockerService } from '../services/docker.service.js';
import { CicdService } from '../services/cicd.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { resolveSafePath } from '../utils/safe-path.js';
import { PortService } from '../services/port.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { assertSafeGitUrl } from '../utils/url-security.js';
import { isValidDomain } from '../utils/naming.js';
import { authMiddleware, requireWrite, requireAdmin, AuthRequest } from '../middleware/auth.js';

export const appRouter = Router();

appRouter.use(authMiddleware);

/** Repository files live under data/builds/<appId>. */
function buildsDirFor(appId: string): string {
  return path.join(CONFIG.DATA_DIR, 'builds', appId);
}

function rejectGitMetadata(filePath: string): void {
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Metadados internos do Git não podem ser acessados pelo painel.');
  }
}

function parsePort(value: unknown, label: string, minimum = 1024): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < minimum || port > 65535) {
    throw new Error(`${label} deve ser um número inteiro entre ${minimum} e 65535.`);
  }
  return port;
}

// Free host port the create form can show as the default.
appRouter.get('/suggest-port', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ port: await PortService.allocate() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.get('/', (req: Request, res: Response) => {
  res.json(AppService.getAll().map(AppService.toPublic));
});

// Pre-Deploy Repo Inspector (Vercel Style Auto-Discovery)
appRouter.post('/inspect-repo', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { gitUrl, branch, githubToken } = req.body;
    if (!gitUrl) {
      res.status(400).json({ error: 'URL do repositório Git é obrigatória' });
      return;
    }

    const result = await CicdService.inspectRepository({ gitUrl, branch, githubToken });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Falha ao inspecionar repositório: ' + err.message });
  }
});

appRouter.post('/', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, sourceType, gitUrl, branch, imageName, port, internalPort, env, domain, githubToken, autoDeploy, deployBranch } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Nome é obrigatório' });
      return;
    }
    if (domain && !isValidDomain(domain)) {
      res.status(400).json({ error: 'Domínio inválido. Informe um nome DNS, não um IP.' });
      return;
    }
    if (sourceType === 'git' && gitUrl) await assertSafeGitUrl(String(gitUrl));

    // The host port is optional: leaving it out assigns a free one. Traffic
    // reaches the application through Caddy on the container's internal port,
    // so there is nothing for the user to coordinate here.
    const created = await AppService.createApp({
      name,
      sourceType: sourceType || 'image',
      gitUrl,
      branch,
      imageName,
      port: parsePort(port, 'A porta do host'),
      internalPort: parsePort(internalPort, 'A porta interna', 1),
      env: AppService.validateEnv(env || {}),
      domain,
      githubToken,
      autoDeploy,
      deployBranch,
    });

    // Returned immediately so the client can open the live deploy stream; the
    // pipeline reports its own outcome over the socket and in the deployment
    // history, so a failure here is never silent.
    res.status(201).json(AppService.toPublic(created));

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

// Update app settings
appRouter.put('/:id', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { name, port, internalPort, imageName, gitUrl, branch, domain, githubToken, autoDeploy, deployBranch } = req.body;

    const previousName = app.name;
    const previousPort = app.port;
    const previousInternalPort = app.internalPort;
    const previousImage = app.imageName;
    const previousGitUrl = app.gitUrl;
    const previousBranch = app.branch;

    if (gitUrl && gitUrl !== previousGitUrl) await assertSafeGitUrl(String(gitUrl));
    if (domain !== undefined && domain !== '' && !isValidDomain(domain)) {
      res.status(400).json({ error: 'Domínio inválido. Informe um nome DNS, não um IP.' });
      return;
    }

    if (name) app.name = name;

    // An empty port field hands the app back to automatic assignment; a value
    // pins it, and the pin is remembered so a later deploy never moves it.
    if (port === '' || port === null) {
      app.autoPort = true;
      app.port = await PortService.allocate(undefined, app.containerId);
    } else if (port) {
      const requested = parsePort(port, 'A porta do host');
      if (requested === undefined) throw new Error('Porta inválida.');
      if (requested !== app.port) {
        const conflict = await PortService.describeConflict(requested, app.containerId);
        if (conflict) {
          res.status(400).json({ error: conflict });
          return;
        }
      }
      app.port = requested;
      app.autoPort = false;
    }
    if (internalPort) {
      const parsedInternalPort = parsePort(internalPort, 'A porta interna', 1);
      if (parsedInternalPort === undefined) throw new Error('Porta interna inválida.');
      app.internalPort = parsedInternalPort;
    }
    if (imageName) app.imageName = imageName;
    if (gitUrl) app.gitUrl = gitUrl;
    if (branch) app.branch = branch;
    if (autoDeploy !== undefined) app.autoDeploy = Boolean(autoDeploy);
    if (deployBranch) app.deployBranch = String(deployBranch);
    if (githubToken !== undefined) {
      app.githubToken = githubToken ? EncryptionService.encrypt(String(githubToken)) : undefined;
    }
    if (domain !== undefined) {
      app.domain = domain ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined;
    }

    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // A rename changes the derived container name. Without removing the old
    // one it keeps running forever, holding the host port and shadowing the
    // new deploy.
    if (name && name !== previousName) {
      await AppService.removeContainerByAppName(previousName);
    }

    if (app.domain) {
      const cleanDom = app.domain.trim().toLowerCase();
      const existingDomain = dbStorage.getDomains().find((d) => d.domain.toLowerCase().trim() === cleanDom);
      if (existingDomain) {
        existingDomain.targetPort = app.port;
        existingDomain.status = 'active';
        dbStorage.saveDomain(existingDomain);
      }
      await CaddyService.syncCaddyfile().catch(() => {});
    }

    // Only rebuild when something the running container actually depends on
    // changed. Renaming an app or editing its domain used to trigger a full
    // rebuild and a minutes-long outage.
    const needsRedeploy =
      app.name !== previousName ||
      app.port !== previousPort ||
      app.internalPort !== previousInternalPort ||
      app.imageName !== previousImage ||
      app.gitUrl !== previousGitUrl ||
      app.branch !== previousBranch;

    if (needsRedeploy) {
      try {
        await CicdService.executeDeploy(app, {
          commitMessage: `Configurações atualizadas (Porta :${app.port})`,
          triggeredBy: 'manual',
        });
      } catch (err: any) {
        res.status(500).json({
          error: `Configurações salvas, mas o redeploy falhou: ${err.message}`,
          app: AppService.toPublic(app),
        });
        return;
      }
    }

    res.json(AppService.toPublic(app));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manage .env variables
appRouter.get('/:id/env', requireWrite, (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }
  res.json({ env: app.env || {} });
});

appRouter.put('/:id/env', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const env = AppService.validateEnv(req.body.env);

    app.env = env;
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    try {
      await CicdService.executeDeploy(app, {
        commitMessage: 'Variáveis de ambiente (.env) atualizadas via AegisPanel',
        triggeredBy: 'manual',
      });
    } catch (deployErr: any) {
      res.status(500).json({
        error: `Variáveis salvas, mas o redeploy falhou: ${deployErr.message}`,
        app: AppService.toPublic(app),
      });
      return;
    }

    res.json({ success: true, app: AppService.toPublic(app) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update domain for a specific app
appRouter.put('/:id/domain', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { domain } = req.body;
    if (domain && !isValidDomain(domain)) {
      res.status(400).json({ error: 'Domínio inválido. Informe um nome DNS, não um IP.' });
      return;
    }
    app.domain = domain
      ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      : undefined;
    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    await CaddyService.syncCaddyfile();

    res.json({ success: true, app: AppService.toPublic(app) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Deployment history
appRouter.get('/:id/deployments', requireWrite, (req: Request, res: Response): void => {
  res.json(dbStorage.getDeployments(req.params.id));
});

// Manual deploy
appRouter.post('/:id/deploy', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    // Answered immediately, like the initial deploy on app creation. Awaiting
    // the pipeline here held the HTTP request open for the whole build, and
    // nginx closes a proxied request after 60s by default: every build longer
    // than a minute surfaced as "erro ao disparar deploy" in the panel while
    // the build carried on running on the server.
    res.status(202).json({ accepted: true, appId: app.id });

    CicdService.executeDeploy(app, {
      commitMessage: req.body.commitMessage || 'Deploy manual disparado pelo painel',
      triggeredBy: 'manual',
    }).catch((err) => {
      console.error(`Manual deploy error for app ${app.name}:`, err.message);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1-click rollback
appRouter.post('/:id/rollback/:deploymentId', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await CicdService.rollback(req.params.id, req.params.deploymentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rotate the webhook secret
appRouter.post('/:id/webhook-secret', requireAdmin, (req: Request, res: Response): void => {
  try {
    res.json({ webhookSecret: AppService.rotateWebhookSecret(req.params.id) });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// Reveal the webhook URL, including the secret
appRouter.get('/:id/webhook', requireAdmin, (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }
  const secret = AppService.getWebhookSecret(app) || AppService.rotateWebhookSecret(app.id);
  const hostUrl = `${req.protocol}://${req.get('host') || 'localhost:4000'}`;
  res.json({
    url: `${hostUrl}/api/webhooks/deploy/${app.id}`,
    secret,
    header: 'X-Aegis-Secret',
  });
});

// GitHub Actions workflow
appRouter.get('/:id/workflow', requireWrite, (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }

  const hostUrl = `${req.protocol}://${req.get('host') || 'localhost:4000'}`;
  res.json({ yaml: CicdService.generateGitHubWorkflow(app, hostUrl) });
});

appRouter.post('/:id/start', requireWrite, async (req: Request, res: Response) => {
  try {
    res.json(AppService.toPublic(await AppService.startApp(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/stop', requireWrite, async (req: Request, res: Response) => {
  try {
    res.json(AppService.toPublic(await AppService.stopApp(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/restart', requireWrite, async (req: Request, res: Response) => {
  try {
    res.json(AppService.toPublic(await AppService.restartApp(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// File explorer: list
appRouter.get('/:id/files', requireWrite, (req: Request, res: Response): void => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const buildsDir = buildsDirFor(app.id);
    const subPath = (req.query.subPath as string) || '';
    rejectGitMetadata(subPath);
    const targetDir = resolveSafePath(buildsDir, subPath);

    if (!fs.existsSync(targetDir)) {
      res.json({ currentPath: subPath, items: [] });
      return;
    }

    const items = fs
      .readdirSync(targetDir, { withFileTypes: true })
      .filter((e) => e.name !== '.git')
      .map((entry) => {
        const itemPath = path.join(targetDir, entry.name);
        let size = 0;
        let modifiedAt = new Date().toISOString();
        try {
          const stat = fs.statSync(itemPath);
          size = stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {
          // unreadable entries are still listed, without metadata
        }

        return {
          name: entry.name,
          path: path.relative(buildsDir, itemPath).replace(/\\/g, '/'),
          isDirectory: entry.isDirectory(),
          sizeBytes: size,
          modifiedAt,
          extension: entry.name.includes('.') ? entry.name.split('.').pop()?.toLowerCase() : '',
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ currentPath: subPath.replace(/\\/g, '/'), items });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

// File explorer: read
appRouter.get('/:id/files/content', requireWrite, (req: Request, res: Response): void => {
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
    rejectGitMetadata(filePath);

    const targetFile = resolveSafePath(buildsDirFor(app.id), filePath);
    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
      return;
    }

    const stat = fs.statSync(targetFile);
    res.json({
      filename: path.basename(targetFile),
      path: filePath.replace(/\\/g, '/'),
      content: fs.readFileSync(targetFile, 'utf-8'),
      sizeBytes: stat.size,
    });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

// File explorer: write
appRouter.put('/:id/files/content', requireWrite, (req: Request, res: Response): void => {
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
    rejectGitMetadata(filePath);

    const targetFile = resolveSafePath(buildsDirFor(app.id), filePath);
    fs.writeFileSync(targetFile, content, 'utf-8');
    res.json({ success: true, message: 'Arquivo salvo com sucesso!' });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

appRouter.get('/:id/logs', requireWrite, async (req: Request, res: Response) => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    if (app.containerId) {
      try {
        const logs = await dockerService.getLogs(app.containerId, 100);
        if (logs && !logs.startsWith('Logs unavailable')) {
          res.json({ logs });
          return;
        }
      } catch {
        // fall through to build logs
      }
    }

    const deployments = dbStorage.getDeployments(app.id);
    if (deployments.length > 0 && deployments[0].buildLogs) {
      let logMsg = `📋 [Logs de Build do CI/CD - Status: ${deployments[0].status.toUpperCase()}]:\n\n`;
      logMsg += CicdService.redactSecrets(deployments[0].buildLogs);
      if (!app.containerId) {
        logMsg += '\n💡 Dica: verifique se o Docker Engine está ativo para que o contêiner suba.';
      }
      res.json({ logs: logMsg });
      return;
    }

    res.json({ logs: 'Aguardando inicialização do container ou primeiro disparo de deploy...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.delete('/:id', requireWrite, async (req: Request, res: Response) => {
  try {
    res.json({ success: await AppService.deleteApp(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
