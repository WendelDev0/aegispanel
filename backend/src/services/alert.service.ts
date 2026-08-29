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
            title: `🛡️ AegisPanel Alerta: ${title}`,
            description,
            color,
            timestamp: new Date().toISOString(),
            footer: { text: 'Aegis VPS Cloud Manager' },
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

      const req = https.request(options);
      req.on('error', (e) => console.error('Discord webhook error:', e.message));
      req.write(payload);
      req.end();
    } catch (err) {
      console.error('Error sending Discord alert:', err);
    }
  }

  static async checkThresholds(cpuPercent: number, memPercent: number, diskPercent: number) {
    const settings = dbStorage.getSettings();
    const config = settings.alertConfig;
    if (!config || !config.enabled || !config.discordWebhookUrl) return;

    // Throttle to 1 alert every 10 minutes
    const now = Date.now();
    if (config.lastAlertSentAt && now - new Date(config.lastAlertSentAt).getTime() < 10 * 60 * 1000) {
      return;
    }

    if (cpuPercent >= config.cpuThresholdPercent) {
      await this.sendDiscordAlert(
        config.discordWebhookUrl,
        'Carga Alta de CPU',
        `⚠️ O uso de CPU da sua VPS atingiu **${cpuPercent}%** (Limite: ${config.cpuThresholdPercent}%).`,
        0xf43f5e
      );
      config.lastAlertSentAt = new Date().toISOString();
      dbStorage.updateSettings({ alertConfig: config });
    } else if (memPercent >= config.memThresholdPercent) {
      await this.sendDiscordAlert(
        config.discordWebhookUrl,
        'Uso Elevado de Memória RAM',
        `⚠️ O consumo de memória RAM da sua VPS atingiu **${memPercent}%** (Limite: ${config.memThresholdPercent}%).`,
        0xf59e0b
      );
      config.lastAlertSentAt = new Date().toISOString();
      dbStorage.updateSettings({ alertConfig: config });
    }
  }
}
