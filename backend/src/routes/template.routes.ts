import { Router, Request, Response } from 'express';
import { TemplateService } from '../services/template.service.js';
import { authMiddleware } from './auth.routes.js';

export const templateRouter = Router();

templateRouter.use(authMiddleware);

templateRouter.get('/', (req: Request, res: Response) => {
  res.json(TemplateService.getCatalog());
});

templateRouter.post('/install', async (req: Request, res: Response): Promise<void> => {
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

    res.status(201).json(app);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
