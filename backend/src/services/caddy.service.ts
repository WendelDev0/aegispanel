import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';

export class CaddyService {
  private static caddyfilePath = CONFIG.CADDY_CONFIG_PATH;

  static async syncCaddyfile(): Promise<string> {
    const dir = path.dirname(this.caddyfilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const domains = dbStorage.getDomains();
    const apps = dbStorage.getApps().filter(a => a.domain && a.status === 'running');

    let content = `# Aegis Auto-Generated Caddyfile\n`;
    content += `{\n  email admin@localhost\n}\n\n`;

    // Direct domain mappings
    for (const d of domains) {
      if (d.status === 'active') {
        content += `${d.domain} {\n`;
        content += `  reverse_proxy localhost:${d.targetPort}\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
      }
    }

    // App domain mappings
    for (const app of apps) {
      if (app.domain && !domains.some(d => d.domain === app.domain)) {
        content += `${app.domain} {\n`;
        content += `  reverse_proxy localhost:${app.port}\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
      }
    }

    fs.writeFileSync(this.caddyfilePath, content, 'utf-8');
    return content;
  }
}
