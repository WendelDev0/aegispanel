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
    const allApps = dbStorage.getApps();
    const appsWithDomain = allApps.filter(a => a.domain);
    const adminUser = dbStorage.getUsers()[0];
    const email = (adminUser && adminUser.email && !adminUser.email.endsWith('.internal'))
      ? adminUser.email
      : 'contato@selvamarketing.com';

    let content = `# Aegis Auto-Generated Caddyfile\n`;
    content += `{\n  email ${email}\n}\n\n`;

    const isLocalDomain = (dom: string) => {
      const clean = dom.toLowerCase();
      return clean === 'localhost' || clean.endsWith('.localhost') || clean.endsWith('.local') || clean === '127.0.0.1';
    };

    // Direct domain mappings from Domains tab
    for (const d of domains) {
      const cleanDom = d.domain.toLowerCase().trim();
      if (!cleanDom) continue;

      const matchingApp = allApps.find(a => a.port === d.targetPort || a.domain?.toLowerCase().trim() === cleanDom);
      const containerName = matchingApp ? `aegis-app-${matchingApp.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}` : '';
      const internalPort = matchingApp ? (matchingApp.internalPort || 3000) : d.targetPort;

      if (isLocalDomain(cleanDom)) {
        content += `${cleanDom} {\n`;
        content += `  tls internal\n`;
        content += `  reverse_proxy ${containerName ? `${containerName}:${internalPort} ` : ''}host.docker.internal:${d.targetPort}\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
      } else {
        const upstreams = [
          containerName ? `${containerName}:${internalPort}` : null,
          `host.docker.internal:${d.targetPort}`,
          `172.17.0.1:${d.targetPort}`,
          `localhost:${d.targetPort}`,
        ].filter(Boolean).join(' ');

        content += `${cleanDom} {\n`;
        content += `  reverse_proxy ${upstreams} {\n`;
        content += `    lb_policy first\n`;
        content += `    lb_try_duration 3s\n`;
        content += `    header_up Host {host}\n`;
        content += `    header_up X-Real-IP {remote_host}\n`;
        content += `    header_up X-Forwarded-For {remote_host}\n`;
        content += `    header_up X-Forwarded-Proto {scheme}\n`;
        content += `  }\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
      }
    }

    // App domain mappings (if not already explicitly configured in domains list)
    for (const app of appsWithDomain) {
      const cleanDom = app.domain?.toLowerCase().trim();
      if (!cleanDom) continue;
      if (domains.some(d => d.domain.toLowerCase().trim() === cleanDom)) continue;

      const containerName = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
      const internalPort = app.internalPort || 3000;

      if (isLocalDomain(cleanDom)) {
        content += `${cleanDom} {\n`;
        content += `  tls internal\n`;
        content += `  reverse_proxy ${containerName}:${internalPort} host.docker.internal:${app.port}\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
      } else {
        const upstreams = [
          `${containerName}:${internalPort}`,
          `host.docker.internal:${app.port}`,
          `172.17.0.1:${app.port}`,
          `localhost:${app.port}`,
        ].join(' ');

        content += `${cleanDom} {\n`;
        content += `  reverse_proxy ${upstreams} {\n`;
        content += `    lb_policy first\n`;
        content += `    lb_try_duration 3s\n`;
        content += `    header_up Host {host}\n`;
        content += `    header_up X-Real-IP {remote_host}\n`;
        content += `    header_up X-Forwarded-For {remote_host}\n`;
        content += `    header_up X-Forwarded-Proto {scheme}\n`;
        content += `  }\n`;
        content += `  encode gzip zstd\n`;
        content += `}\n\n`;
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
