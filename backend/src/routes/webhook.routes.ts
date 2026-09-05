import { Router, Request, Response } from 'express';
import { dbStorage } from '../db/storage.js';
import { CicdService } from '../services/cicd.service.js';
import { AppService } from '../services/app.service.js';
import { AuditStore } from '../utils/audit.store.js';
import {
  authorizeWebhook,
  parseWebhookEvent,
  type WebhookHeaders,
} from '../utils/git-webhook.js';
import { matchTagGlob } from '../utils/app-build.js';
import {
  decidePreviewAction,
  defaultPreviewConfig,
  previewDomain,
  previewExpiresAt,
} from '../utils/app-preview.js';
import { CONFIG } from '../config.js';

export const webhookRouter = Router();

interface RawBodyRequest extends Request {
  rawBody?: string;
}

function webhookIp(req: Request): string | undefined {
  const ip = req.ip || req.socket.remoteAddress;
  return ip?.replace(/^::ffff:/, '') || undefined;
}

function headerMap(req: Request): WebhookHeaders {
  const headers: WebhookHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value;
  }
  return headers;
}

const lastTrigger = new Map<string, number>();
const MIN_INTERVAL_MS = 5000;

webhookRouter.post('/deploy/:appId', async (req: RawBodyRequest, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const app = dbStorage.getAppById(appId);
    if (!app) {
      res.status(404).json({ error: 'Aplicação não encontrada' });
      return;
    }

    if (!app.webhookSecret) {
      AuditStore.append({
        ip: webhookIp(req),
        action: 'webhook.deploy.reject',
        outcome: 'forbidden',
        target: { type: 'app', id: app.id, name: app.name },
        meta: { reason: 'missing_secret' },
      });
      res.status(403).json({
        error:
          'Esta aplicação não possui segredo de webhook configurado. Gere um no painel em Aplicações > Webhook antes de usar o deploy automático.',
      });
      return;
    }

    const headers = headerMap(req);
    const authorized = authorizeWebhook(headers, req.rawBody || '', AppService.getWebhookSecret(app));
    if (!authorized.ok) {
      AuditStore.append({
        ip: webhookIp(req),
        action: 'webhook.deploy.reject',
        outcome: 'forbidden',
        target: { type: 'app', id: app.id, name: app.name },
        meta: { reason: 'invalid_credential' },
      });
      res.status(403).json({ error: authorized.error });
      return;
    }

    const now = Date.now();
    const previous = lastTrigger.get(appId) || 0;
    if (now - previous < MIN_INTERVAL_MS) {
      res.status(429).json({ error: 'Deploy já disparado há poucos segundos. Aguarde antes de tentar novamente.' });
      return;
    }
    lastTrigger.set(appId, now);

    if (app.autoDeploy === false) {
      res.status(409).json({ error: 'Deploy automático está desativado para esta aplicação.' });
      return;
    }

    const parsed = parseWebhookEvent(headers, req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }

    if (parsed.event.kind === 'pr') {
      return handlePreview(app, parsed.event, res, req);
    }

    if (parsed.event.kind === 'tag') {
      const glob = app.deploy?.onTag;
      if (!glob || !matchTagGlob(parsed.event.tag, glob)) {
        res.status(202).json({
          accepted: true,
          ignored: true,
          reason: glob ? `Tag ${parsed.event.tag} fora de ${glob}.` : 'Deploy por tag não configurado.',
        });
        return;
      }
      AuditStore.append({
        ip: webhookIp(req),
        action: 'webhook.deploy.accept',
        outcome: 'success',
        target: { type: 'app', id: app.id, name: app.name },
        meta: { tag: parsed.event.tag, commitHash: parsed.event.headSha },
      });
      CicdService.executeDeploy(app, {
        commitHash: parsed.event.headSha,
        commitMessage: parsed.event.message || `Tag ${parsed.event.tag}`,
        authorName: parsed.event.author || 'git',
        branch: app.deployBranch || app.branch || 'main',
        triggeredBy: 'webhook',
        tag: parsed.event.tag,
      }).catch((err) => console.error(`Webhook tag deploy error for ${app.name}:`, err.message));
      res.status(202).json({ accepted: true, message: `Deploy da tag ${parsed.event.tag} aceito.` });
      return;
    }

    const branch = parsed.event.branch;
    const expectedBranch = app.deployBranch || app.branch || 'main';
    if (branch !== expectedBranch) {
      res.status(202).json({ accepted: true, ignored: true, reason: `Branch ignorada; esperado: ${expectedBranch}.` });
      return;
    }

    AuditStore.append({
      ip: webhookIp(req),
      action: 'webhook.deploy.accept',
      outcome: 'success',
      target: { type: 'app', id: app.id, name: app.name },
      meta: { branch, commitHash: parsed.event.headSha },
    });

    CicdService.executeDeploy(app, {
      commitHash: parsed.event.headSha,
      commitMessage: parsed.event.message || 'Git Push Auto-Deploy',
      authorName: parsed.event.author || 'git',
      branch,
      triggeredBy: headers['x-github-event'] || headers['x-aegis-secret'] ? 'webhook' : 'github_action',
    }).catch((err) => console.error(`Webhook deploy error for ${app.name}:`, err.message));

    res.status(202).json({ accepted: true, message: `Deploy aceito para ${app.name}` });
  } catch (err: any) {
    console.error('CI/CD deploy execution error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function handlePreview(
  app: ReturnType<typeof dbStorage.getAppById> & object,
  event: Extract<import('../utils/git-webhook.js').WebhookEvent, { kind: 'pr' }>,
  res: Response,
  req: Request
): void {
  const config = app.deploy?.previews || defaultPreviewConfig();
  const existing = dbStorage.getAppPreview(app.id, event.number);
  const all = dbStorage.getAppPreviews(app.id);
  const decision = decidePreviewAction(event, existing, { ...defaultPreviewConfig(), ...config }, all);

  if (decision.action === 'ignore') {
    res.status(202).json({ accepted: true, ignored: true, reason: decision.reason });
    return;
  }
  if (decision.action === 'remove') {
    dbStorage.removeAppPreview(app.id, event.number);
    res.status(202).json({ accepted: true, removed: true });
    return;
  }

  const settings = dbStorage.getSettings();
  const base = config.domainPattern
    ? undefined
    : settings.previewBaseDomain || settings.panelDomain || 'preview.localhost';
  const domain = previewDomain(event.number, config.domainPattern || 'pr-{n}.{base}', {
    app: app.name,
    base,
  });
  const record = {
    id: existing?.id || `prev-${app.id}-${event.number}`,
    appId: app.id,
    prNumber: event.number,
    branch: event.branch,
    headSha: event.headSha,
    domain,
    containerIds: existing?.containerIds || [],
    createdAt: existing?.createdAt || new Date().toISOString(),
    expiresAt: previewExpiresAt(config.ttlHours),
    status: 'building' as const,
  };
  dbStorage.saveAppPreview(record);

  if (CONFIG.LOCAL_MODE) {
    console.warn('Modo local: preview criado sem comentar no pull request.');
  }

  CicdService.executeDeploy(app, {
    commitHash: event.headSha,
    commitMessage: `Preview PR #${event.number}`,
    authorName: 'preview',
    branch: event.branch,
    triggeredBy: 'webhook',
    preview: { prNumber: event.number, branch: event.branch, headSha: event.headSha },
  }).catch((err) => console.error(`Preview deploy error for ${app.name}:`, err.message));

  AuditStore.append({
    ip: webhookIp(req),
    action: 'webhook.preview.accept',
    outcome: 'success',
    target: { type: 'app', id: app.id, name: app.name },
    meta: { pr: event.number, domain },
  });

  res.status(202).json({ accepted: true, preview: true, domain, action: decision.action });
}
