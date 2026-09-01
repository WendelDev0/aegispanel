import { Router, Request, Response } from 'express';
import { TemplateService } from '../services/template.service.js';
import { AppService } from '../services/app.service.js';
import { authMiddleware, requireWrite } from '../middleware/auth.js';

export const templateRouter = Router();

templateRouter.use(authMiddleware);

templateRouter.get('/', (req: Request, res: Response) => {
  res.json(TemplateService.getCatalog());
});

templateRouter.get('/updates', (req: Request, res: Response) => {
  try {
    const summary = TemplateService.getUpdatesSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

templateRouter.post('/upgrade-app', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { appId } = req.body;
    if (!appId) {
      res.status(400).json({ error: 'App ID é obrigatório' });
      return;
    }

    const updatedApp = await TemplateService.upgradeInstalledApp(appId);
    res.json(AppService.toPublic(updatedApp));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

templateRouter.post('/install', requireWrite, async (req: Request, res: Response): Promise<void> => {
  try {
    const { templateId, customPort, customName, apiKey, postgresDbId, redisDbId, customEnv } = req.body;
    if (!templateId) {
      res.status(400).json({ error: 'Template ID é obrigatório' });
      return;
    }

    const app = await TemplateService.installTemplate(templateId, {
      customPort: customPort ? parseInt(customPort) : undefined,
      customName,
      apiKey,
      postgresDbId,
      redisDbId,
      customEnv,
    });

    // Template installation generates API keys and database credentials. Keep
    // the response subject to the same redaction as ordinary app creation.
    res.status(201).json(AppService.toPublic(app));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
