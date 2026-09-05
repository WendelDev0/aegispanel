import http from 'http';
import https from 'https';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { EncryptionService } from '../utils/crypto.js';
import { evolutionSendText } from '../utils/evolution.client.js';
import { WaFlowEngine } from './wa-flow-engine.js';

/**
 * Blocks outbound notifications from a development copy.
 *
 * A local instance restored from a production backup carries the real Discord
 * webhook, Telegram token and WhatsApp key. Left unguarded it would page the
 * team from a developer's laptop.
 */
function outboundBlocked(channel: string): boolean {
  if (!CONFIG.LOCAL_MODE || CONFIG.ALLOW_OUTBOUND_ALERTS) return false;
  console.warn(
    `🧪 Modo local: notificação para ${channel} NÃO enviada. ` +
      'Defina AEGIS_ALLOW_OUTBOUND_ALERTS=true para permitir envios reais daqui.'
  );
  return true;
}

export class AlertService {
  private static reveal(value: string | undefined): string | undefined {
    if (!value) return value;
    return EncryptionService.tryDecrypt(value) ?? value;
  }

  static async sendDiscordAlert(webhookUrl: string, title: string, description: string, color: number = 0x6366f1) {
    if (outboundBlocked('Discord')) return;
    webhookUrl = this.reveal(webhookUrl) || '';
    if (!webhookUrl) return;

    try {
      const url = new URL(webhookUrl);
      const payload = JSON.stringify({
        embeds: [
          {
            title: `🛡️ AegisPanel: ${title}`,
            description,
            color,
            timestamp: new Date().toISOString(),
            footer: { text: 'AegisPanel Cloud Manager' },
          },
        ],
      });

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(options);
      req.on('error', (e) => console.error('Discord webhook error:', e.message));
      req.write(payload);
      req.end();
    } catch (err) {
      console.error('Error sending Discord alert:', err);
    }
  }

  static async sendTelegramAlert(botToken: string, chatId: string, text: string) {
    if (outboundBlocked('Telegram')) return;
    botToken = this.reveal(botToken) || '';
    if (!botToken || !chatId) return;

    try {
      const payload = JSON.stringify({
        chat_id: chatId,
        text: `🛡️ *AegisPanel Cloud Alert*\n\n${text}`,
        parse_mode: 'Markdown',
      });

      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = https.request(options);
      req.on('error', (e) => console.error('Telegram alert error:', e.message));
      req.write(payload);
      req.end();
    } catch (err) {
      console.error('Error sending Telegram alert:', err);
    }
  }

  static async sendWhatsAppAlert(apiUrl: string, apiKey: string, instance: string, number: string, message: string) {
    if (outboundBlocked('WhatsApp')) return;
    await evolutionSendText(
      { apiUrl, apiKey, instance },
      number,
      `🛡️ *AegisPanel Cloud Manager*\n\n${message}`
    );
  }

  static async broadcastNotification(
    title: string,
    message: string,
    type: 'deploy' | 'alert' | 'backup' = 'deploy',
    isError = false,
    meta?: { appId?: string }
  ) {
    const settings = dbStorage.getSettings();
    const config = settings.alertConfig;

    if (type === 'deploy' && isError && config?.notifyOnDeployFail === false) return;
    if (type === 'deploy' && !isError && config?.notifyOnDeploySuccess === false) return;
    if (type === 'backup' && config?.notifyOnBackup === false) return;
    if (type === 'alert' && config?.notifyOnHighResource === false) return;

    // History is the in-panel record; Discord/Telegram are optional fans-out.
    dbStorage.addAlertHistory({
      title,
      message,
      type,
      isError,
      appId: meta?.appId,
    });

    const mapped = WaFlowEngine.mapBroadcast(type, isError);
    if (mapped) {
      const appName = meta?.appId ? dbStorage.getAppById(meta.appId)?.name : undefined;
      void WaFlowEngine.handlePanelEvent(mapped, {
        evento: mapped,
        app: appName || '',
        titulo: title,
        mensagem: message,
      }).catch((err) => {
        console.error('WhatsApp flow event failed:', err?.message || err);
      });
    }

    if (!config || !config.enabled) return;

    const formattedMessage = `*${title}*\n${message}`;

    // Discord
    if (config.discordWebhookUrl) {
      const color = isError ? 0xf43f5e : (type === 'backup' ? 0x10b981 : 0x6366f1);
      this.sendDiscordAlert(config.discordWebhookUrl, title, message, color);
    }

    // Telegram
    if (config.telegramBotToken && config.telegramChatId) {
      this.sendTelegramAlert(config.telegramBotToken, config.telegramChatId, formattedMessage);
    }

    // WhatsApp Evolution API
    if (config.whatsappEnabled && config.whatsappApiUrl && config.whatsappApiKey && config.whatsappInstance && config.whatsappRecipientNumber) {
      this.sendWhatsAppAlert(
        config.whatsappApiUrl,
        config.whatsappApiKey,
        config.whatsappInstance,
        config.whatsappRecipientNumber,
        formattedMessage
      );
    }
  }

  /**
   * Evaluates every resource threshold.
   *
   * Each metric is checked independently and throttled independently: the
   * previous version chained them with else-if, so memory was never evaluated
   * while CPU was high, and the disk threshold was not evaluated at all - a
   * full disk produced no alert.
   */
  private static lastAlertByMetric: Record<string, number> = {};
  private static readonly THROTTLE_MS = 10 * 60 * 1000;

  static async checkThresholds(cpuPercent: number, memPercent: number, diskPercent: number) {
    const config = dbStorage.getSettings().alertConfig;
    if (!config || !config.enabled) return;

    const checks: Array<{
      metric: string;
      value: number;
      threshold: number;
      title: string;
      label: string;
    }> = [
      {
        metric: 'cpu',
        value: cpuPercent,
        threshold: config.cpuThresholdPercent,
        title: '⚠️ Alerta: Carga Alta de CPU',
        label: 'uso de CPU',
      },
      {
        metric: 'memory',
        value: memPercent,
        threshold: config.memThresholdPercent,
        title: '⚠️ Alerta: Uso Elevado de Memória RAM',
        label: 'consumo de memória RAM',
      },
      {
        metric: 'disk',
        value: diskPercent,
        threshold: config.diskThresholdPercent,
        title: '⚠️ Alerta: Disco Quase Cheio',
        label: 'uso de disco',
      },
    ];

    const now = Date.now();

    for (const check of checks) {
      if (!Number.isFinite(check.value) || !Number.isFinite(check.threshold)) continue;
      if (check.value < check.threshold) continue;

      const last = this.lastAlertByMetric[check.metric] || 0;
      if (now - last < this.THROTTLE_MS) continue;
      this.lastAlertByMetric[check.metric] = now;

      const rounded = Math.round(check.value * 10) / 10;

      await this.broadcastNotification(
        check.title,
        `O ${check.label} da sua VPS atingiu *${rounded}%* (limite: ${check.threshold}%).`,
        'alert',
        true
      );

      dbStorage.addActivity({
        type: 'alert',
        title: check.title.replace('⚠️ Alerta: ', 'Alerta de '),
        description: `${check.label} atingiu ${rounded}% (limite: ${check.threshold}%)`,
        status: 'warning',
        metadata: { metric: check.metric, value: rounded, threshold: check.threshold },
      });

      // Persisted only when an alert actually fired. This method runs every
      // two seconds, so an unconditional write here would rewrite the whole
      // database file continuously.
      dbStorage.updateSettings({
        alertConfig: { ...config, lastAlertSentAt: new Date().toISOString() },
      });
    }
  }
}
