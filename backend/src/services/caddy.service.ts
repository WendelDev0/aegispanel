import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';

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
    content += `{\n  # Automatic Let's Encrypt HTTPS\n  auto_https disable_redirects\n}\n\n`;

    const isLocalDomain = (dom: string) => {
      const clean = dom.toLowerCase();
      return clean === 'localhost' || clean.endsWith('.localhost') || clean.endsWith('.local') || clean === '127.0.0.1';
    };

    // Direct domain mappings (Handles both HTTP and HTTPS smoothly)
    for (const d of domains) {
      if (d.status === 'active') {
        const cleanDom = d.domain.toLowerCase().trim();
        if (isLocalDomain(cleanDom)) {
          content += `${cleanDom} {\n`;
          content += `  tls internal\n`;
          content += `  reverse_proxy host.docker.internal:${d.targetPort}\n`;
          content += `  encode gzip zstd\n`;
          content += `}\n\n`;
        } else {
          content += `http://${cleanDom}, https://${cleanDom} {\n`;
          content += `  reverse_proxy host.docker.internal:${d.targetPort} {\n`;
          content += `    header_up Host {host}\n`;
          content += `    header_up X-Real-IP {remote_host}\n`;
          content += `    header_up X-Forwarded-For {remote_host}\n`;
          content += `    header_up X-Forwarded-Proto {scheme}\n`;
          content += `  }\n`;
          content += `  encode gzip zstd\n`;
          content += `}\n\n`;
        }
      }
    }

    // App domain mappings (if not already in domains list)
    for (const app of apps) {
      if (app.domain && !domains.some(d => d.domain === app.domain)) {
        const cleanDom = app.domain.toLowerCase().trim();
        if (isLocalDomain(cleanDom)) {
          content += `${cleanDom} {\n`;
          content += `  tls internal\n`;
          content += `  reverse_proxy host.docker.internal:${app.port}\n`;
          content += `  encode gzip zstd\n`;
          content += `}\n\n`;
        } else {
          content += `http://${cleanDom}, https://${cleanDom} {\n`;
          content += `  reverse_proxy host.docker.internal:${app.port} {\n`;
          content += `    header_up Host {host}\n`;
          content += `    header_up X-Real-IP {remote_host}\n`;
          content += `    header_up X-Forwarded-For {remote_host}\n`;
          content += `    header_up X-Forwarded-Proto {scheme}\n`;
          content += `  }\n`;
          content += `  encode gzip zstd\n`;
          content += `}\n\n`;
        }
      }
    }

    fs.writeFileSync(this.caddyfilePath, content, 'utf-8');

    // Reload Caddy container if running
    try {
      const client = dockerService.getDockerClient();
      const caddyContainer = client.getContainer('aegis-caddy');
      const exec = await caddyContainer.exec({
        Cmd: ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
        AttachStdout: true,
        AttachStderr: true,
      });
      await exec.start({});
      console.log('🔄 Caddy reloaded successfully with updated domains.');
    } catch (err: any) {
      console.warn('Caddy reload notice:', err.message);
    }

    return content;
  }
}
