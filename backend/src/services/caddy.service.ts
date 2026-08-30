import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { containerNameForApp } from '../utils/naming.js';

const CADDY_CONTAINER = 'aegis-caddy';

/**
 * Shared access log, inside the Caddy container.
 *
 * One file for every site, attributed per host when parsed: Caddy is the only
 * component that sees every request to every application, so this is the one
 * place analytics can be collected without touching the applications
 * themselves or injecting a script into their pages.
 */
const ACCESS_LOG_PATH = '/var/log/caddy/access.log';

/** Rejects anything that is not a plausible hostname before it reaches the config. */
const HOSTNAME = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isLocalDomain(domain: string): boolean {
  const clean = domain.toLowerCase();
  return (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean === '127.0.0.1'
  );
}

export class CaddyService {
  private static caddyfilePath = CONFIG.CADDY_CONFIG_PATH;

  /**
   * Resolves the ACME contact address.
   *
   * Taken from panel settings, then from the first administrator's address.
   * There is deliberately no hardcoded fallback: shipping one means every
   * installation of this project requests certificates under a stranger's
   * email.
   */
  private static resolveAcmeEmail(): string | undefined {
    const settings = dbStorage.getSettings();
    if (settings.notificationEmail && settings.notificationEmail.includes('@')) {
      return settings.notificationEmail;
    }

    const admin = dbStorage.getUsers().find((u) => u.role === 'admin');
    if (admin?.email && admin.email.includes('@') && !admin.email.endsWith('.internal')) {
      return admin.email;
    }

    return undefined;
  }

  /**
   * Renders one site block.
   *
   * A single upstream is used on purpose. The previous version listed four
   * (container, host.docker.internal, 172.17.0.1, localhost) with
   * `lb_policy first`, which is a load-balancing policy, not a failover chain:
   * Caddy distributes across every upstream it considers healthy. `localhost`
   * inside the Caddy container resolves to Caddy itself, so a share of the
   * requests were proxied back into the proxy.
   */
  private static renderSite(domain: string, upstream: string, useInternalTls: boolean): string {
    const lines = [`${domain} {`];
    if (useInternalTls) {
      lines.push('  tls internal');
    }
    lines.push(`  reverse_proxy ${upstream} {`);
    lines.push('    header_up Host {host}');
    lines.push('    header_up X-Real-IP {remote_host}');
    lines.push('    header_up X-Forwarded-For {remote_host}');
    lines.push('    header_up X-Forwarded-Proto {scheme}');
    // Passive health checking: an upstream that refuses connections is taken
    // out of rotation instead of returning 502 to the visitor on every retry.
    lines.push('    lb_try_duration 5s');
    lines.push('    fail_duration 10s');
    lines.push('    max_fails 3');
    lines.push('  }');
    lines.push('  encode gzip zstd');
    lines.push('}');
    return lines.join('\n') + '\n\n';
  }

  static async syncCaddyfile(): Promise<string> {
    const dir = path.dirname(this.caddyfilePath);
    fs.mkdirSync(dir, { recursive: true });

    const domains = dbStorage.getDomains();
    const allApps = dbStorage.getApps();
    const email = this.resolveAcmeEmail();

    let content = '# Aegis Auto-Generated Caddyfile\n';
    content += '# Gerado automaticamente pelo AegisPanel. Edições manuais são sobrescritas.\n';
    if (email) {
      content += `{\n  email ${email}\n}\n\n`;
    } else {
      content +=
        '# Nenhum e-mail de contato configurado: defina "notificationEmail" nas configurações\n' +
        '# do painel para que o Let\'s Encrypt possa avisar sobre expiração de certificados.\n\n';
      console.warn(
        '⚠️ Caddy: nenhum e-mail ACME configurado. Defina o e-mail de notificação nas configurações do painel.'
      );
    }

    const rendered = new Set<string>();

    const addSite = (rawDomain: string, appName: string | undefined, hostPort: number, internalPort: number) => {
      const domain = rawDomain.toLowerCase().trim();
      if (!domain || rendered.has(domain)) return;
      if (!HOSTNAME.test(domain)) {
        console.warn(`⚠️ Caddy: domínio ignorado por formato inválido: "${domain}"`);
        return;
      }
      rendered.add(domain);

      // Prefer the container name over the host port: it stays correct when
      // the host port changes and keeps traffic on the internal network.
      const upstream = appName
        ? `${containerNameForApp(appName)}:${internalPort}`
        : `host.docker.internal:${hostPort}`;

      content += this.renderSite(domain, upstream, isLocalDomain(domain));
    };

    for (const d of domains) {
      const matchingApp =
        allApps.find((a) => a.domain?.toLowerCase().trim() === d.domain.toLowerCase().trim()) ||
        allApps.find((a) => a.port === d.targetPort);
      addSite(d.domain, matchingApp?.name, d.targetPort, matchingApp?.internalPort || d.targetPort);
    }

    for (const app of allApps) {
      if (!app.domain) continue;
      addSite(app.domain, app.name, app.port, app.internalPort || 3000);
    }

    fs.writeFileSync(this.caddyfilePath, content, 'utf-8');

    await this.reload();
    return content;
  }

  /**
   * Validates and reloads the Caddy configuration.
   *
   * The validation step matters: on an invalid config Caddy keeps serving the
   * previous one and exits non-zero, so without checking the result the panel
   * would report a successful sync while the change never took effect.
   */
  static async reload(): Promise<{ success: boolean; message: string }> {
    try {
      const validate = await dockerService.execInContainer(
        CADDY_CONTAINER,
        ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'],
        { timeoutMs: 30_000 }
      );

      if (validate.exitCode !== 0) {
        const message = (validate.stderr || validate.stdout).trim();
        console.error('❌ Caddyfile inválido, reload abortado:\n' + message);
        return { success: false, message };
      }

      const reload = await dockerService.execInContainer(
        CADDY_CONTAINER,
        ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
        { timeoutMs: 60_000 }
      );

      if (reload.exitCode !== 0) {
        const message = (reload.stderr || reload.stdout).trim();
        console.error('❌ Falha ao recarregar o Caddy:\n' + message);
        return { success: false, message };
      }

      console.log('🔄 Caddy recarregado com os domínios atualizados.');
      return { success: true, message: 'Caddy recarregado com sucesso.' };
    } catch (err: any) {
      // The container may legitimately be absent in local development.
      const message = err.message || String(err);
      console.warn('Caddy reload notice:', message);
      return { success: false, message };
    }
  }

  /** Clears the ACME cache so Let's Encrypt issues fresh certificates. */
  static async resetAcmeCache(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await dockerService.execInContainer(
        CADDY_CONTAINER,
        ['rm', '-rf', '/data/caddy/acme'],
        { timeoutMs: 30_000 }
      );

      if (result.exitCode !== 0) {
        return { success: false, message: (result.stderr || result.stdout).trim() };
      }

      return await this.reload();
    } catch (err: any) {
      return { success: false, message: err.message || String(err) };
    }
  }
}
