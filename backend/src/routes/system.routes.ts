import { Router, Request, Response } from 'express';
import { SystemService } from '../services/system.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { AlertService } from '../services/alert.service.js';
import { dockerService } from '../services/docker.service.js';
import { dbStorage, PanelSettings, AlertConfig } from '../db/storage.js';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { EncryptionService } from '../utils/crypto.js';
import { PanelService } from '../services/panel.service.js';

export const systemRouter = Router();

systemRouter.use(authMiddleware);

/** Placeholder returned in place of a stored secret. */
const MASK = '••••••••';

/**
 * Removes credentials from settings before they leave the API.
 *
 * The raw object holds a Telegram bot token, an Evolution API key and a
 * Discord webhook URL. Any of those is enough to take over the channel, and
 * the settings screen only needs to know whether one is configured.
 */
function redactSettings(settings: PanelSettings): PanelSettings {
  const alert = settings.alertConfig || ({} as AlertConfig);
  return {
    ...settings,
    alertConfig: {
      ...alert,
      discordWebhookUrl: alert.discordWebhookUrl ? MASK : undefined,
      telegramBotToken: alert.telegramBotToken ? MASK : undefined,
      whatsappApiKey: alert.whatsappApiKey ? MASK : undefined,
    },
  };
}

/**
 * Merges an incoming settings patch, keeping any secret the client sent back
 * unchanged as the mask. Without this, saving the settings form would wipe
 * every token the user cannot see.
 */
function mergeSettings(current: PanelSettings, patch: Partial<PanelSettings>): Partial<PanelSettings> {
  if (!patch.alertConfig) return patch;

  const incoming = patch.alertConfig as Partial<AlertConfig>;
  const keepIfMasked = <K extends keyof AlertConfig>(key: K): AlertConfig[K] =>
    incoming[key] === MASK || incoming[key] === undefined ? current.alertConfig?.[key] : (incoming[key] as AlertConfig[K]);

  return {
    ...patch,
    alertConfig: {
      ...current.alertConfig,
      ...incoming,
      discordWebhookUrl: keepIfMasked('discordWebhookUrl'),
      telegramBotToken: keepIfMasked('telegramBotToken'),
      whatsappApiKey: keepIfMasked('whatsappApiKey'),
    } as AlertConfig,
  };
}

function encryptAlertSecrets(patch: Partial<PanelSettings>): Partial<PanelSettings> {
  if (!patch.alertConfig) return patch;
  const alert = { ...patch.alertConfig } as AlertConfig;
  for (const key of ['discordWebhookUrl', 'telegramBotToken', 'whatsappApiKey'] as const) {
    const value = alert[key];
    if (value && value !== MASK && !EncryptionService.isEncrypted(value)) {
      alert[key] = EncryptionService.encrypt(value) as never;
    }
  }
  return { ...patch, alertConfig: alert };
}

systemRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    res.json(await SystemService.getRealtimeStats());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/storage-health', requireAdmin, (req: Request, res: Response) => {
  res.json(dbStorage.getStorageHealth());
});

systemRouter.get('/history', (req: Request, res: Response) => {
  const range = (req.query.range as string) || 'realtime';
  res.json(
    SystemService.getHistoricalMetrics(range, req.query.startDate as string, req.query.endDate as string)
  );
});

systemRouter.post('/speedtest', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await SystemService.runSpeedtest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/processes', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    res.json(await SystemService.getTopProcesses(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const stats = await SystemService.getRealtimeStats();
    const dockerAvailable = await dockerService.testConnection();
    const containers = await dockerService.listContainers(true);
    const databases = dbStorage.getDatabases();
    const apps = dbStorage.getApps();

    res.json({
      system: stats,
      docker: {
        isAvailable: dockerAvailable,
        totalContainers: containers.length,
        runningContainers: containers.filter((c) => c.state === 'running').length,
      },
      counts: {
        apps: apps.length,
        runningApps: apps.filter((a) => a.status === 'running').length,
        databases: databases.length,
        runningDatabases: databases.filter((d) => d.status === 'running').length,
      },
      settings: redactSettings(dbStorage.getSettings()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/settings', (req: Request, res: Response) => {
  res.json(redactSettings(dbStorage.getSettings()));
});

systemRouter.put('/settings', requireAdmin, (req: Request, res: Response) => {
  const current = dbStorage.getSettings();
  const updated = dbStorage.updateSettings(encryptAlertSecrets(mergeSettings(current, req.body || {})));
  res.json(redactSettings(updated));

  // Both of these feed the generated Caddyfile: panelDomain is the panel's own
  // site block, and notificationEmail is the ACME contact address. Saving them
  // used to change nothing until the next restart picked them up in the
  // startup auto-heal, which reads as "the domain setting does not work".
  if (
    updated.panelDomain !== current.panelDomain ||
    updated.notificationEmail !== current.notificationEmail
  ) {
    CaddyService.syncCaddyfile().catch((err) => {
      console.warn('Caddy sync after settings update failed:', err.message);
    });
  }
});

// Export full panel state (migration bundle)
systemRouter.get('/export-state', requireAdmin, (req: Request, res: Response): void => {
  try {
    // Serialised from the in-memory document rather than read off disk, so the
    // export always reflects committed state even mid-write.
    const payload = dbStorage.exportState();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=aegispanel-migration-${Date.now()}.json`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import full panel state
systemRouter.post('/import-state', requireAdmin, (req: AuthRequest, res: Response): void => {
  try {
    const stateData = req.body;

    // Validated before it replaces anything: this endpoint used to write the
    // request body straight over panel_db.json, so any authenticated caller
    // could substitute the users array and take over the panel.
    const problems = dbStorage.validateState(stateData);
    if (problems.length > 0) {
      res.status(400).json({
        error: 'Arquivo de estado inválido.',
        details: problems,
      });
      return;
    }

    // The importing administrator must still exist afterwards, otherwise the
    // import locks everyone out of the panel.
    const importedUsers = stateData.users as Array<{ id: string; role: string }>;
    if (!importedUsers.some((u) => u.role === 'admin')) {
      res.status(400).json({ error: 'O estado importado não contém nenhum administrador.' });
      return;
    }

    dbStorage.importState(stateData);

    res.json({
      success: true,
      warning: importedUsers.some((u) => u.id === req.user!.id)
        ? undefined
        : 'Sua conta não existe no estado importado; faça login com um usuário do backup.',
      message: 'Estado completo importado com sucesso.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Force Caddy SSL/proxy reset (clears ACME cache and regenerates the Caddyfile)
systemRouter.post('/caddy-reset', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const caddyContent = await CaddyService.syncCaddyfile();

    const reset = await CaddyService.resetAcmeCache();

    res.json({
      success: reset.success,
      message: reset.success
        ? 'Cache ACME limpo e Caddyfile regenerado. O Let\'s Encrypt emitirá novos certificados SSL.'
        : `Caddyfile regenerado, mas a limpeza do cache ACME falhou: ${reset.message}`,
      caddyfile: caddyContent,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/activities', (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
  res.json(dbStorage.getActivities(limit));
});

// Test a notification channel
systemRouter.post('/test-alert', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { channel } = req.body;
    const stored = dbStorage.getSettings().alertConfig || ({} as AlertConfig);

    // Masked fields fall back to what is stored, so the test can be run from
    // the settings screen without the secret ever being sent to the browser.
    const pick = (incoming: string | undefined, fallback: string | undefined) =>
      !incoming || incoming === MASK ? fallback : incoming;

    if (channel === 'discord') {
      await AlertService.sendDiscordAlert(
        pick(req.body.webhookUrl, stored.discordWebhookUrl) || '',
        'Teste de Notificação Discord',
        '🎉 Integração de Alertas com AegisPanel funcionando com sucesso!',
        0x10b981
      );
    } else if (channel === 'telegram') {
      await AlertService.sendTelegramAlert(
        pick(req.body.botToken, stored.telegramBotToken) || '',
        pick(req.body.chatId, stored.telegramChatId) || '',
        '🎉 *Teste de Alerta AegisPanel!*\n\nSua integração com o Telegram foi configurada com sucesso.'
      );
    } else if (channel === 'whatsapp') {
      await AlertService.sendWhatsAppAlert(
        pick(req.body.apiUrl, stored.whatsappApiUrl) || '',
        pick(req.body.apiKey, stored.whatsappApiKey) || '',
        pick(req.body.instance, stored.whatsappInstance) || '',
        pick(req.body.recipientNumber, stored.whatsappRecipientNumber) || '',
        '🎉 *Teste de Alerta AegisPanel!*\n\nSua integração com o WhatsApp Evolution API foi configurada com sucesso.'
      );
    } else {
      res.status(400).json({ error: `Canal desconhecido: ${channel}` });
      return;
    }

    res.json({ success: true, message: `Mensagem de teste enviada via ${channel}!` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/panel/log-targets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ targets: PanelService.listLogTargets() });
});

systemRouter.get('/panel/logs/:target', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const tail = req.query.tail ? Number(req.query.tail) : 200;
    const logs = await PanelService.getStackLogs(req.params.target, tail);
    res.json({ target: req.params.target, logs });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

systemRouter.post('/panel/self-update', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await PanelService.selfUpdate();
    res.json({
      success: true,
      message: 'Self-update da stack iniciado/concluído.',
      output: result.output,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
