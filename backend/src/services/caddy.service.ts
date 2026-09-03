import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { NodeService } from './node.service.js';
import { isValidDomain } from '../utils/naming.js';
import { resolveAppUpstream } from '../utils/app-upstream.js';

const CADDY_CONTAINER = CONFIG.CADDY_CONTAINER;

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
    if (settings.notificationEmail && /^[^\s{}]+@[^\s{}]+$/.test(settings.notificationEmail)) {
      return settings.notificationEmail;
    }

    const admin = dbStorage.getUsers().find((u) => u.role === 'admin');
    if (admin?.email && /^[^\s{}]+@[^\s{}]+$/.test(admin.email) && !admin.email.endsWith('.internal')) {
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
  private static renderSite(
    domain: string,
    upstream: string,
    useInternalTls: boolean,
    extras?: { securityHeaders?: boolean }
  ): string {
    const lines = [`${domain} {`];
    if (useInternalTls) {
      lines.push('  tls internal');
    }
    if (extras?.securityHeaders) {
      // The panel is a control plane. Apps keep their own headers; locking
      // these down on every site would break embeds and third-party fonts.
      lines.push('  header {');
      lines.push('    Strict-Transport-Security "max-age=31536000; includeSubDomains"');
      lines.push('    X-Frame-Options DENY');
      lines.push('    X-Content-Type-Options nosniff');
      lines.push('    Referrer-Policy no-referrer');
      lines.push(
        '    Content-Security-Policy "default-src \'self\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'self\'; connect-src \'self\' wss: ws:; frame-ancestors \'none\'"'
      );
      lines.push('    -Server');
      lines.push('  }');
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
    lines.push('  log {');
    lines.push(`    output file ${ACCESS_LOG_PATH}`);
    lines.push('    format json');
    lines.push('  }');
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

    // Caddy accepts exactly one global options block, so every global
    // directive is collected here and emitted together.
    const globalDirectives: string[] = [];

    if (CONFIG.LOCAL_MODE) {
      // local_certs makes Caddy sign everything with its own internal CA and
      // never contact an ACME provider. Without it, a development copy holding
      // production domains would request public certificates for hostnames it
      // does not serve: those attempts fail, and repeated failures count
      // against the rate limit of the real domain on the real server.
      content += '# MODO LOCAL: certificados internos, nenhuma requisição ao Let\'s Encrypt.\n';
      globalDirectives.push('local_certs');
      console.warn('🧪 Modo local: Caddy usará certificados internos; nenhum certificado público será solicitado.');
    } else if (email) {
      globalDirectives.push(`email ${email}`);
    } else {
      content +=
        '# Nenhum e-mail de contato configurado: defina "notificationEmail" nas configurações\n' +
        '# do painel para que o Let\'s Encrypt possa avisar sobre expiração de certificados.\n';
      console.warn(
        '⚠️ Caddy: nenhum e-mail ACME configurado. Defina o e-mail de notificação nas configurações do painel.'
      );
    }

    // Behind a CDN or proxy, the connecting address is the proxy's, so the
    // access log records that instead of the visitor and analytics attributes
    // every visit to a handful of datacenters. Declaring the proxy ranges as
    // trusted makes Caddy derive client_ip from X-Forwarded-For.
    //
    // Opt-in on purpose: trusting that header without a proxy in front lets
    // any caller forge its own address by setting it.
    if (CONFIG.TRUSTED_PROXIES.length) {
      globalDirectives.push(
        `servers {\n    trusted_proxies static ${CONFIG.TRUSTED_PROXIES.join(' ')}\n  }`
      );
    }

    if (globalDirectives.length) {
      content += `{\n  ${globalDirectives.join('\n  ')}\n}\n\n`;
    } else {
      content += '\n';
    }

    const rendered = new Set<string>();

    const addSite = (
      rawDomain: string,
      app: { name: string; nodeId?: string; port: number; internalPort?: number } | undefined,
      hostPort: number,
      internalPort: number
    ) => {
      const domain = rawDomain.toLowerCase().trim();
      if (!domain || rendered.has(domain)) return;
      if (!isValidDomain(domain)) {
        console.warn(`⚠️ Caddy: domínio ignorado por formato inválido: "${domain}"`);
        return;
      }
      rendered.add(domain);

      // Prefer container DNS on the panel network; remote apps use hostIp:port
      // because Caddy cannot resolve names on another Docker daemon.
      const upstream = app
        ? resolveAppUpstream(
            { name: app.name, nodeId: app.nodeId, port: app.port || hostPort, internalPort: app.internalPort || internalPort },
            app.nodeId ? NodeService.getById(app.nodeId) : null
          )
        : `host.docker.internal:${hostPort}`;

      content += this.renderSite(domain, upstream, CONFIG.LOCAL_MODE || isLocalDomain(domain));
    };

    // The panel's own domain is rendered first, so an application that happens
    // to carry the same hostname cannot take the panel's place in the config
    // and lock the operator out of the UI.
    const panelDomain = dbStorage.getSettings().panelDomain?.toLowerCase().trim();
    if (panelDomain) {
      if (isValidDomain(panelDomain)) {
        rendered.add(panelDomain);
        content += this.renderSite(
          panelDomain,
          CONFIG.PANEL_UPSTREAM,
          CONFIG.LOCAL_MODE || isLocalDomain(panelDomain),
          { securityHeaders: true }
        );
      } else {
        console.warn(`⚠️ Caddy: domínio do painel ignorado por formato inválido: "${panelDomain}"`);
      }
    }

    for (const d of domains) {
      const matchingApp =
        allApps.find((a) => a.domain?.toLowerCase().trim() === d.domain.toLowerCase().trim()) ||
        allApps.find((a) => a.port === d.targetPort);
      addSite(d.domain, matchingApp, d.targetPort, matchingApp?.internalPort || d.targetPort);
    }

    for (const app of allApps) {
      if (!app.domain) continue;
      addSite(app.domain, app, app.port, app.internalPort || 3000);
    }

    fs.writeFileSync(this.caddyfilePath, content, 'utf-8');

    const reload = await this.reload();
    if (!reload.success) {
      throw new Error(`Caddyfile salvo, mas o Caddy não foi recarregado: ${reload.message}`);
    }
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
        ['rm', '-rf', '/data/caddy/acme', '/data/caddy/certificates'],
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
