import { Router, Request, Response } from 'express';
import { dbStorage } from '../db/storage.js';
import { CicdService } from '../services/cicd.service.js';

export const webhookRouter = Router();

// GitHub Webhook & General Webhook endpoint
webhookRouter.post('/deploy/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const secret = req.query.secret as string;
    const signature = req.headers['x-hub-signature-256'] as string;

    const app = dbStorage.getAppById(appId);
    if (!app) {
      res.status(404).json({ error: 'Aplicação não encontrada' });
      return;
    }

    if (app.webhookSecret && secret && app.webhookSecret !== secret) {
      res.status(403).json({ error: 'Segredo de webhook inválido' });
      return;
    }

    // Extract GitHub commit data if sent from GitHub
    const body = req.body || {};
    const headCommit = body.head_commit || body;
    const commitHash = headCommit.id || body.commit || (headCommit.sha ? headCommit.sha.substring(0, 8) : undefined);
    const commitMessage = headCommit.message || body.message || 'GitHub Push Auto-Deploy';
    const authorName = headCommit.author?.name || headCommit.author?.username || body.author || 'GitHub';
    const branch = body.ref ? body.ref.replace('refs/heads/', '') : body.branch || app.branch || 'main';

    console.log(`🚀 [GitHub CI/CD] Webhook recebido para "${app.name}" na branch "${branch}" - Commit: ${commitHash}`);

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
    console.error('CI/CD deploy execution error:', err);
    res.status(500).json({ error: err.message });
  }
});
