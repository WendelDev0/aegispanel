import http from 'http';
import https from 'https';
import { dbStorage } from '../db/storage.js';

export class AlertService {
  static async sendDiscordAlert(webhookUrl: string, title: string, description: string, color: number = 0x6366f1) {
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
    if (!apiUrl || !apiKey || !instance || !number) return;

    try {
      const cleanNumber = number.replace(/\D/g, '');
      const formattedUrl = apiUrl.replace(/\/+$/, '');
      const fullEndpoint = `${formattedUrl}/message/sendText/${instance}`;
      const url = new URL(fullEndpoint);

      const payload = JSON.stringify({
        number: cleanNumber,
        text: `🛡️ *AegisPanel Cloud Manager*\n\n${message}`,
        options: {
          delay: 1200,
          presence: 'composing',
        },
      });

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = transport.request(options);
      req.on('error', (e) => console.error('Evolution API WhatsApp alert error:', e.message));
      req.write(payload);
      req.end();
    } catch (err) {
      console.error('Error sending WhatsApp Evolution alert:', err);
    }
  }

  static async broadcastNotification(title: string, message: string, type: 'deploy' | 'alert' | 'backup' = 'deploy', isError = false) {
    const settings = dbStorage.getSettings();
    const config = settings.alertConfig;
    if (!config || !config.enabled) return;

    // Check notification rules
    if (type === 'deploy' && isError && config.notifyOnDeployFail === false) return;
    if (type === 'deploy' && !isError && config.notifyOnDeploySuccess === false) return;
    if (type === 'backup' && config.notifyOnBackup === false) return;
    if (type === 'alert' && config.notifyOnHighResource === false) return;

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

  static async checkThresholds(cpuPercent: number, memPercent: number, diskPercent: number) {
    const settings = dbStorage.getSettings();
    const config = settings.alertConfig;
    if (!config || !config.enabled) return;

    // Throttle to 1 alert every 10 minutes
    const now = Date.now();
    if (config.lastAlertSentAt && now - new Date(config.lastAlertSentAt).getTime() < 10 * 60 * 1000) {
      return;
    }

    if (cpuPercent >= config.cpuThresholdPercent) {
      await this.broadcastNotification(
        '⚠️ Alerta: Carga Alta de CPU',
        `O uso de CPU da sua VPS atingiu *${cpuPercent}%* (Limite: ${config.cpuThresholdPercent}%).`,
        'alert',
        true
      );
      config.lastAlertSentAt = new Date().toISOString();
      dbStorage.updateSettings({ alertConfig: config });

      dbStorage.addActivity({
        type: 'alert',
        title: 'Alerta de CPU Alta',
        description: `CPU atingiu ${cpuPercent}% (Limite: ${config.cpuThresholdPercent}%)`,
        status: 'warning',
      });
    } else if (memPercent >= config.memThresholdPercent) {
      await this.broadcastNotification(
        '⚠️ Alerta: Uso Elevado de Memória RAM',
        `O consumo de memória RAM da sua VPS atingiu *${memPercent}%* (Limite: ${config.memThresholdPercent}%).`,
        'alert',
        true
      );
      config.lastAlertSentAt = new Date().toISOString();
      dbStorage.updateSettings({ alertConfig: config });

      dbStorage.addActivity({
        type: 'alert',
        title: 'Alerta de Memória RAM Alta',
        description: `Memória RAM atingiu ${memPercent}% (Limite: ${config.memThresholdPercent}%)`,
        status: 'warning',
      });
    }
  }
}
