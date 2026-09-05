import { Router, Request, Response } from 'express';
import { SystemService, primaryDiskUsage } from '../services/system.service.js';
import { BuildsCleanupService } from '../services/builds-cleanup.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { AlertService } from '../services/alert.service.js';
import { BackupService } from '../services/backup.service.js';
import { dockerService } from '../services/docker.service.js';
import { dbStorage, PanelSettings, AlertConfig } from '../db/storage.js';
import { authMiddleware, requireAdmin, requireAdmin2fa, AuthRequest, clientIp } from '../middleware/auth.js';
import { EncryptionService } from '../utils/crypto.js';
import { PanelService } from '../services/panel.service.js';
import { AuditStore } from '../utils/audit.store.js';
import { validateBody } from '../middleware/validate.js';
import {
  updateSettingsBodySchema,
  importStateBodySchema,
  testAlertBodySchema,
  emptyBodySchema,
} from '../validation/schemas.js';

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
  const target = settings.backupTarget;
  return {
    ...settings,
    waFlowWebhookSecret: settings.waFlowWebhookSecret ? MASK : undefined,
    backupTarget: target
      ? {
          ...target,
          secretAccessKey: target.secretAccessKey ? MASK : undefined,
        }
      : undefined,
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
  let next: Partial<PanelSettings> = { ...patch };
  if (patch.backupTarget) {
    const incoming = patch.backupTarget;
    const stored = current.backupTarget;
    next = {
      ...next,
      backupTarget: {
        provider: 's3',
        endpoint: incoming.endpoint ?? stored?.endpoint,
        region: incoming.region || stored?.region || '',
        bucket: incoming.bucket || stored?.bucket || '',
        prefix: incoming.prefix ?? stored?.prefix,
        accessKeyId: incoming.accessKeyId || stored?.accessKeyId || '',
        secretAccessKey:
          incoming.secretAccessKey === MASK || incoming.secretAccessKey === undefined
            ? stored?.secretAccessKey
            : incoming.secretAccessKey,
        lastUploadAt: stored?.lastUploadAt,
        lastError: stored?.lastError,
      },
    };
  }
  if (!patch.alertConfig) return next;

  const incoming = patch.alertConfig as Partial<AlertConfig>;
  const keepIfMasked = <K extends keyof AlertConfig>(key: K): AlertConfig[K] =>
    incoming[key] === MASK || incoming[key] === undefined ? current.alertConfig?.[key] : (incoming[key] as AlertConfig[K]);

  return {
    ...next,
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
  let next = patch;
  if (
    next.backupTarget?.secretAccessKey &&
    next.backupTarget.secretAccessKey !== MASK &&
    !EncryptionService.isEncrypted(next.backupTarget.secretAccessKey)
  ) {
    next = {
      ...next,
      backupTarget: {
        ...next.backupTarget,
        secretAccessKey: EncryptionService.encrypt(next.backupTarget.secretAccessKey),
      },
    };
  }
  if (!next.alertConfig) return next;
  const alert = { ...next.alertConfig } as AlertConfig;
  for (const key of ['discordWebhookUrl', 'telegramBotToken', 'whatsappApiKey'] as const) {
    const value = alert[key];
    if (value && value !== MASK && !EncryptionService.isEncrypted(value)) {
      alert[key] = EncryptionService.encrypt(value) as never;
    }
  }
  return { ...next, alertConfig: alert };
}

/**
 * Distance to the thresholds that would justify moving panel state to SQLite.
 *
 * Recorded in docs/ADR-0001-panel-state-json.md. Reported as numbers so the
 * decision is made on evidence instead of on someone's impression that the
 * panel feels slow — and so that "we are at 40% of the trigger" is a visible
 * fact rather than a thing nobody measured until it hurt.
 */
function migrationTriggerStatus() {
  const health = dbStorage.getStorageHealth();
  const records = health.recordCounts;
  const workloads = (records.apps || 0) + (records.databases || 0);
  const saveP95Ms = dbStorage.saveP95Ms();

  const limits = { fileSizeMB: 8, workloads: 150, saveP95Ms: 200 };
  return {
    limits,
    current: { fileSizeMB: health.fileSizeMB, workloads, saveP95Ms },
    reached:
      health.fileSizeMB >= limits.fileSizeMB ||
      workloads >= limits.workloads ||
      (saveP95Ms > 0 && saveP95Ms >= limits.saveP95Ms),
  };
}

systemRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    res.json(await SystemService.getRealtimeStats());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/storage-health', requireAdmin, async (req: Request, res: Response) => {
  // Composed here rather than inside getStorageHealth: storage.ts is the state
  // singleton and must not import a service. Reporting only panel_db.json told
  // the operator the panel was healthy while `builds/` was eating the disk.
  res.json({
    ...dbStorage.getStorageHealth(),
    directories: BuildsCleanupService.directoryUsage(),
    buildsCapMb: dbStorage.getSettings().buildsDiskCapMb,
    hostDisk: await primaryDiskUsage(),
    // The migration trigger from ADR-0001, reported rather than guessed at.
    migrationTrigger: migrationTriggerStatus(),
  });
});

/**
 * Point-in-time copies of panel_db.json taken before destructive changes.
 *
 * Admin-only like every other view of panel state: the delta exposes how many
 * users, apps and databases exist.
 */
systemRouter.get('/state/snapshots', requireAdmin, (req: Request, res: Response) => {
  res.json(
    dbStorage.listSnapshots().map((snapshot) => ({
      name: snapshot.name,
      reason: snapshot.reason,
      takenAt: new Date(snapshot.takenAtMs).toISOString(),
      sizeBytes: snapshot.sizeBytes,
    }))
  );
});

/** What restoring a snapshot would change, per collection. */
systemRouter.get('/state/snapshots/:name/delta', requireAdmin, (req: Request, res: Response): void => {
  try {
    res.json(dbStorage.snapshotDelta(req.params.name));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * Restores a snapshot. Behind 2FA, not just the admin role.
 *
 * This replaces every user, application and database record in one call, which
 * is the same blast radius as the host terminal. A stolen session that only had
 * to be an admin token could roll the panel back to a state containing an
 * account the attacker controls.
 */
systemRouter.post(
  '/state/rollback/:name',
  requireAdmin,
  requireAdmin2fa,
  validateBody(emptyBodySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const restored = dbStorage.restoreSnapshot(req.params.name);

      AuditStore.append({
        actor: req.user
          ? { id: req.user.id, username: req.user.username, role: req.user.role }
          : undefined,
        sid: req.user?.sid,
        ip: clientIp(req),
        action: 'system.state.rollback',
        outcome: 'success',
        target: { type: 'snapshot', name: req.params.name },
      });

      dbStorage.addActivity({
        type: 'system',
        title: 'Estado do painel restaurado',
        description: `Snapshot ${req.params.name} restaurado por ${req.user?.username || 'admin'}.`,
        status: 'warning',
        metadata: { snapshot: req.params.name },
      });

      // Domains and applications may differ from what Caddy is serving; a
      // rollback that left the proxy pointing at the previous set would route
      // traffic to containers the restored state does not know about.
      await CaddyService.syncCaddyfile().catch((err: any) =>
        console.warn('Caddy sync após rollback de estado:', err?.message)
      );

      res.json({
        success: true,
        message: 'Estado restaurado. Todas as sessões foram revogadas; faça login novamente.',
        counts: {
          users: restored.users.length,
          apps: restored.apps.length,
          databases: restored.databases.length,
        },
      });
    } catch (err: any) {
      AuditStore.append({
        actor: req.user
          ? { id: req.user.id, username: req.user.username, role: req.user.role }
          : undefined,
        ip: clientIp(req),
        action: 'system.state.rollback',
        outcome: 'failure',
        target: { type: 'snapshot', name: req.params.name },
        meta: { error: err.message },
      });
      res.status(400).json({ error: err.message });
    }
  }
);

systemRouter.get('/history', (req: Request, res: Response) => {
  const range = (req.query.range as string) || 'realtime';
  res.json(
    SystemService.getHistoricalMetrics(range, req.query.startDate as string, req.query.endDate as string)
  );
});

systemRouter.post('/speedtest', requireAdmin, validateBody(emptyBodySchema), async (req: Request, res: Response): Promise<void> => {
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
      restoreDrill: BackupService.latestDrillStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

systemRouter.get('/settings', (req: Request, res: Response) => {
  res.json(redactSettings(dbStorage.getSettings()));
});

systemRouter.put('/settings', requireAdmin, validateBody(updateSettingsBodySchema), (req: Request, res: Response) => {
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
systemRouter.post('/import-state', requireAdmin, validateBody(importStateBodySchema), (req: AuthRequest, res: Response): void => {
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

    AuditStore.append({
      actor: { id: req.user!.id, username: req.user!.username, role: req.user!.role },
      sid: req.user!.sid,
      ip: clientIp(req),
      action: 'system.import',
      outcome: 'success',
    });

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
systemRouter.post('/caddy-reset', requireAdmin, validateBody(emptyBodySchema), async (req: Request, res: Response): Promise<void> => {
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

systemRouter.get('/alert-history', (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  res.json(dbStorage.getAlertHistory(undefined, limit));
});

systemRouter.get('/audit', requireAdmin, (req: Request, res: Response): void => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
  const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined;
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const events = AuditStore.query({
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    actor,
    action,
    limit,
  });
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=aegis-audit.csv');
    const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = 'ts,actor,role,ip,action,outcome\n';
    const rows = events
      .map((e) =>
        [
          csvCell(e.ts),
          csvCell(e.actor?.username || ''),
          csvCell(e.actor?.role || ''),
          csvCell(e.ip || ''),
          csvCell(e.action),
          csvCell(e.outcome),
        ].join(',')
      )
      .join('\n');
    res.send(header + rows);
    return;
  }
  res.json(events);
});

// Test a notification channel
systemRouter.post('/test-alert', requireAdmin, validateBody(testAlertBodySchema), async (req: Request, res: Response): Promise<void> => {
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

systemRouter.get('/panel/update-status', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await PanelService.updateStatus(force));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

systemRouter.post('/panel/self-update', requireAdmin, validateBody(emptyBodySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await PanelService.selfUpdate();
    AuditStore.append({
      actor: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : undefined,
      sid: req.user?.sid,
      ip: clientIp(req),
      action: 'panel.self-update',
      outcome: 'success',
    });
    res.json({
      success: true,
      message: 'Self-update da stack iniciado/concluído.',
      output: result.output,
    });
  } catch (err: any) {
    AuditStore.append({
      actor: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : undefined,
      sid: req.user?.sid,
      ip: clientIp(req),
      action: 'panel.self-update',
      outcome: 'failure',
      meta: { error: err.message },
    });
    res.status(400).json({ error: err.message });
  }
});
