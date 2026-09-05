import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AppService } from '../services/app.service.js';
import { dockerService } from '../services/docker.service.js';
import { CicdService } from '../services/cicd.service.js';
import { DeployQueueService } from '../services/deploy-queue.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { AppLogStore } from '../utils/app-log.store.js';
import { resolveSafePath } from '../utils/safe-path.js';
import { PortService } from '../services/port.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { assertSafeGitUrl } from '../utils/url-security.js';
import { isValidDomain } from '../utils/naming.js';
import { getPublicBaseUrl } from '../utils/public-url.js';
import { NodeService } from '../services/node.service.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { authMiddleware, requireWrite, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  createAppBodySchema,
  updateAppBodySchema,
  inspectRepoBodySchema,
  updateEnvBodySchema,
  updateDomainBodySchema,
  deployAppBodySchema,
  fileContentBodySchema,
  emptyBodySchema,
} from '../validation/schemas.js';

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

appRouter.get('/metrics', requireWrite, async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await AppService.listMetrics());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.get('/queue', requireWrite, (_req: Request, res: Response): void => {
  res.json(DeployQueueService.status());
});

appRouter.get('/:id', (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }
  res.json(AppService.toPublic(app));
});

// Pre-Deploy Repo Inspector (Vercel Style Auto-Discovery)
appRouter.post('/inspect-repo', requireWrite, validateBody(inspectRepoBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { gitUrl, branch, githubToken } = req.body;
    const result = await CicdService.inspectRepository({ gitUrl, branch, githubToken });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Falha ao inspecionar repositório: ' + err.message });
  }
});

appRouter.post('/', requireWrite, validateBody(createAppBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, sourceType, gitUrl, branch, imageName, port, internalPort, env, domain, githubToken, autoDeploy, deployBranch, nodeId } = req.body;
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
      nodeId,
      limits: req.body.limits,
    });

    // Returned immediately so the client can open the live deploy stream; the
    // pipeline reports its own outcome over the socket and in the deployment
    // history, so a failure here is never silent.
    res.status(201).json({
      ...AppService.toPublic(created),
      // A warning, never a block: overcommit is normal and usually fine, since
      // workloads rarely peak together. What is not fine is discovering during
      // an incident that nobody ever did the arithmetic.
      overcommit: AppService.overcommitStatus(),
    });

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
appRouter.put('/:id', requireWrite, validateBody(updateAppBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const app = dbStorage.getAppById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App não encontrado' });
      return;
    }

    const { name, port, internalPort, imageName, gitUrl, branch, domain, githubToken, autoDeploy, deployBranch, nodeId, limits } = req.body;

    const previousName = app.name;
    const previousLimits = JSON.stringify(AppService.resolveLimits(app));
    const previousHealthcheck = JSON.stringify(app.healthcheck ?? null);
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
      app.port = await PortService.allocate(undefined, app.containerId, { excludeAppId: app.id });
    } else if (port) {
      const requested = parsePort(port, 'A porta do host');
      if (requested === undefined) throw new Error('Porta inválida.');
      if (requested !== app.port) {
        const conflict = await PortService.describeConflict(requested, app.containerId, {
          excludeAppId: app.id,
        });
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
    if (nodeId !== undefined) {
      app.nodeId = nodeId || undefined;
    }
    // null clears the per-app ceiling and hands the app back to the global
    // default, mirroring how an empty port field restores automatic allocation.
    if (limits !== undefined) {
      app.limits = limits === null ? undefined : limits;
    }
    if (req.body.healthcheck !== undefined) {
      app.healthcheck = req.body.healthcheck === null ? undefined : req.body.healthcheck;
    }

    app.updatedAt = new Date().toISOString();
    dbStorage.saveApp(app);

    // A rename changes the derived container name. Without removing the old
    // one it keeps running forever, holding the host port and shadowing the
    // new deploy.
    if (name && name !== previousName) {
      const remoteClient =
        isRemoteTarget(app.nodeId, app.nodeId ? NodeService.getById(app.nodeId) : null) && app.nodeId
          ? await NodeService.getClient(app.nodeId).catch(() => undefined)
          : undefined;
      await AppService.removeContainerByAppName(previousName, remoteClient);
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
      app.branch !== previousBranch ||
      // Memory, NanoCpus and PidsLimit are fixed at create time; the container
      // has to be recreated for a new ceiling to take effect at all. The same
      // is true of Docker's healthcheck.
      JSON.stringify(AppService.resolveLimits(app)) !== previousLimits ||
      JSON.stringify(app.healthcheck ?? null) !== previousHealthcheck;

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

appRouter.put('/:id/env', requireWrite, validateBody(updateEnvBodySchema), async (req: Request, res: Response): Promise<void> => {
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
appRouter.put('/:id/domain', requireWrite, validateBody(updateDomainBodySchema), async (req: Request, res: Response): Promise<void> => {
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

appRouter.get('/:id/deployments/:depId/logs', requireWrite, (req: Request, res: Response): void => {
  const dep = dbStorage.getDeploymentById(req.params.id, req.params.depId);
  if (!dep) {
    res.status(404).json({ error: 'Deploy não encontrado' });
    return;
  }
  const logs = dbStorage.getDeploymentLogs(req.params.id, req.params.depId);
  res.json({
    deploymentId: dep.id,
    appId: dep.appId,
    status: dep.status,
    buildLogs: CicdService.redactSecrets(logs),
  });
});

appRouter.get('/:id/metrics', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await AppService.getMetrics(req.params.id));
  } catch (err: any) {
    const status = err.message === 'App não encontrado' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

appRouter.get('/:id/alerts', requireWrite, (req: Request, res: Response): void => {
  const app = dbStorage.getAppById(req.params.id);
  if (!app) {
    res.status(404).json({ error: 'App não encontrado' });
    return;
  }
  res.json(dbStorage.getAlertHistory(app.id, 50));
});

// Manual deploy
appRouter.post('/:id/deploy', requireWrite, validateBody(deployAppBodySchema), async (req: Request, res: Response): Promise<void> => {
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

/**
 * Rebuilds a past deployment's exact commit.
 *
 * Distinct from the two verbs that already existed, and the panel needed all
 * three:
 *
 *   deploy   — builds whatever is at the branch head
 *   rollback — restarts an image that was already built, in seconds, no build
 *   redeploy — builds the same commit again, with today's configuration
 *
 * The third matters here more than it would elsewhere, because this pipeline
 * bakes public build-time values (NEXT_PUBLIC_ and VITE_ prefixes) into the
 * image via injectPublicBuildArgs. Editing one of those and restarting keeps serving a
 * bundle with the old value; the only way to apply it was to deploy the branch
 * head, which also publishes any code that landed since. Redeploy applies the
 * new configuration to the commit that is actually in production.
 */
appRouter.post(
  '/:id/deployments/:deploymentId/redeploy',
  requireWrite,
  validateBody(emptyBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const app = dbStorage.getAppById(req.params.id);
      if (!app) {
        res.status(404).json({ error: 'App não encontrado' });
        return;
      }

      const deployment = dbStorage.getDeploymentById(app.id, req.params.deploymentId);
      if (!deployment) {
        res.status(404).json({ error: 'Deploy não encontrado no histórico desta aplicação.' });
        return;
      }

      // Without a commit there is nothing to pin the rebuild to, and building
      // the branch head under the label "redeploy" would publish code the user
      // did not ask for.
      if (app.sourceType === 'git' && !deployment.commitHash) {
        res.status(400).json({
          error:
            'Este deploy não registrou o commit de origem, então não é possível reconstruí-lo. Use "Deploy" para publicar o topo da branch.',
        });
        return;
      }

      // Answered before the build for the same reason as /deploy: the pipeline
      // outlives the proxy's request timeout.
      res.status(202).json({ accepted: true, appId: app.id, commitHash: deployment.commitHash });

      CicdService.executeDeploy(app, {
        commitHash: deployment.commitHash,
        commitMessage: deployment.commitMessage
          ? `[Redeploy] ${deployment.commitMessage}`
          : `Redeploy do commit #${deployment.commitHash}`,
        authorName: deployment.authorName,
        branch: deployment.branch,
        triggeredBy: 'manual',
      }).catch((err) => {
        console.error(`Redeploy error for app ${app.name}:`, err.message);
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 1-click rollback
appRouter.delete('/:id/deployments/:deploymentId/queue', requireWrite, (req: Request, res: Response): void => {
  // Only a queued deploy. A running one may be mid-swap — previous container
  // renamed aside, new one starting — and killing it there leaves the app with
  // neither.
  const cancelled = DeployQueueService.cancel(req.params.deploymentId);
  if (!cancelled) {
    res.status(409).json({
      error: 'Este deploy já começou ou não está mais na fila; não é possível cancelar.',
    });
    return;
  }
  res.json({ success: true });
});


appRouter.post('/:id/rollback/:deploymentId', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await CicdService.rollback(req.params.id, req.params.deploymentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rotate the webhook secret
appRouter.post('/:id/webhook-secret', requireAdmin, validateBody(emptyBodySchema), (req: Request, res: Response): void => {
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
  const hostUrl = getPublicBaseUrl(dbStorage.getSettings());
  if (!hostUrl) {
    res.status(503).json({ error: 'Configure AEGIS_PUBLIC_BASE_URL ou o domínio do painel antes de gerar o webhook.' });
    return;
  }
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

  const hostUrl = getPublicBaseUrl(dbStorage.getSettings());
  if (!hostUrl) {
    res.status(503).json({ error: 'Configure AEGIS_PUBLIC_BASE_URL ou o domínio do painel antes de gerar o workflow.' });
    return;
  }
  res.json({ yaml: CicdService.generateGitHubWorkflow(app, hostUrl) });
});

appRouter.post('/:id/start', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response) => {
  try {
    res.json(AppService.toPublic(await AppService.startApp(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/stop', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response) => {
  try {
    res.json(AppService.toPublic(await AppService.stopApp(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.post('/:id/restart', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response) => {
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
appRouter.put('/:id/files/content', requireWrite, validateBody(fileContentBodySchema), (req: Request, res: Response): void => {
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
        const remote =
          isRemoteTarget(app.nodeId, app.nodeId ? NodeService.getById(app.nodeId) : null);
        const client = remote && app.nodeId ? await NodeService.getClient(app.nodeId) : undefined;
        const logs = await dockerService.getLogs(app.containerId, 200, client);
        if (logs && !logs.startsWith('Logs unavailable')) {
          AppLogStore.append(app.id, logs);
          res.json({
            logs: CicdService.redactSecrets(logs),
            retainedBytes: AppLogStore.size(app.id),
            source: 'live',
          });
          return;
        }
      } catch {
        // fall through to retained / build logs
      }
    }

    const retained = AppLogStore.read(app.id);
    if (retained) {
      res.json({
        logs: CicdService.redactSecrets(retained),
        retainedBytes: AppLogStore.size(app.id),
        source: 'retained',
      });
      return;
    }

    const deployments = dbStorage.getDeployments(app.id);
    if (deployments.length > 0) {
      const buildLogs = dbStorage.getDeploymentLogs(app.id, deployments[0].id);
      if (buildLogs) {
        let logMsg = `📋 [Logs de Build do CI/CD - Status: ${deployments[0].status.toUpperCase()}]:\n\n`;
        logMsg += CicdService.redactSecrets(buildLogs);
        if (!app.containerId) {
          logMsg += '\n💡 Dica: verifique se o Docker Engine está ativo para que o contêiner suba.';
        }
        res.json({ logs: logMsg });
        return;
      }
    }

    res.json({ logs: 'Aguardando inicialização do container ou primeiro disparo de deploy...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

appRouter.delete('/:id', requireWrite, validateBody(emptyBodySchema), async (req: Request, res: Response) => {
  try {
    res.json({ success: await AppService.deleteApp(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
