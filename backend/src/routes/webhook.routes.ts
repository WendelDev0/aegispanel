import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { dbStorage } from '../db/storage.js';
import { CicdService } from '../services/cicd.service.js';

export const webhookRouter = Router();

interface RawBodyRequest extends Request {
  rawBody?: string;
}

/**
 * The raw payload is needed to verify GitHub's HMAC signature, which is
 * computed over the exact bytes sent. Re-serialising the parsed object would
 * produce a different string and fail verification.
 */
webhookRouter.use(
  express.json({
    limit: '512kb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf.toString('utf-8');
    },
  })
);

/** Length-safe constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Simple per-app throttle so a leaked URL cannot be used to spin the build
// queue continuously.
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

    /**
     * Authentication is mandatory.
     *
     * The previous check was `if (app.webhookSecret && secret && ...)`, and
     * webhookSecret was never assigned anywhere, so the condition was always
     * false and the endpoint accepted any caller. Apps created before this
     * change have no secret yet and are rejected until one is generated in the
     * panel, rather than being left open.
     */
    if (!app.webhookSecret) {
      res.status(403).json({
        error:
          'Esta aplicação não possui segredo de webhook configurado. Gere um no painel em Aplicações > Webhook antes de usar o deploy automático.',
      });
      return;
    }

    const providedSecret =
      (req.headers['x-aegis-secret'] as string | undefined) || (req.query.secret as string | undefined);
    const githubSignature = req.headers['x-hub-signature-256'] as string | undefined;

    const authorized = githubSignature
      ? CicdService.verifyGitHubSignature(req.rawBody || '', githubSignature, app.webhookSecret)
      : Boolean(providedSecret) && safeEqual(providedSecret!, app.webhookSecret);

    if (!authorized) {
      console.warn(`⛔ Webhook rejeitado para "${app.name}": credencial inválida.`);
      res.status(403).json({ error: 'Credencial de webhook inválida' });
      return;
    }

    const now = Date.now();
    const previous = lastTrigger.get(appId) || 0;
    if (now - previous < MIN_INTERVAL_MS) {
      res.status(429).json({ error: 'Deploy já disparado há poucos segundos. Aguarde antes de tentar novamente.' });
      return;
    }
    lastTrigger.set(appId, now);

    const body = req.body || {};
    const headCommit = body.head_commit || body;
    const commitHash =
      headCommit.id || body.commit || (headCommit.sha ? String(headCommit.sha).substring(0, 8) : undefined);
    const commitMessage = headCommit.message || body.message || 'GitHub Push Auto-Deploy';
    const authorName = headCommit.author?.name || headCommit.author?.username || body.author || 'GitHub';
    const branch = body.ref ? String(body.ref).replace('refs/heads/', '') : body.branch || app.branch || 'main';

    console.log(`🚀 [CI/CD] Webhook aceito para "${app.name}" na branch "${branch}" - commit ${commitHash}`);

    const deployment = await CicdService.executeDeploy(app, {
      commitHash,
      commitMessage,
      authorName,
      branch,
      triggeredBy: body.head_commit ? 'webhook' : 'github_action',
    });

    res.status(200).json({
      success: true,
      message: `Deploy concluído com sucesso para ${app.name}`,
      deploymentId: deployment.id,
      durationSeconds: deployment.durationSeconds,
    });
  } catch (err: any) {
    console.error('CI/CD deploy execution error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
