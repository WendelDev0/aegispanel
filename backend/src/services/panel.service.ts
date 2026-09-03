import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config.js';
import { dockerService } from './docker.service.js';

/** Only these container name prefixes may be tailed through PanelService. */
const ALLOWED_LOG_TARGETS = new Set([
  'aegis-backend',
  'aegis-frontend',
  'aegis-caddy',
  'aegis-nginx',
]);

/**
 * Operations against the panel's own Compose stack.
 *
 * Self-update rebuilds the stack from the compose directory. It is refused in
 * LOCAL_MODE so a developer copy cannot pull and restart the production
 * containers sitting on a shared Docker socket.
 */
export class PanelService {
  static resolveComposeDir(): string {
    if (process.env.AEGIS_COMPOSE_DIR) {
      return path.resolve(process.env.AEGIS_COMPOSE_DIR);
    }
    // Default: repo root is one level above backend cwd when running from source,
    // or the install path `/opt/aegispanel` when packaged.
    const candidates = [
      path.resolve(process.cwd(), '..'),
      process.cwd(),
      '/opt/aegispanel',
    ];
    for (const dir of candidates) {
      if (
        fs.existsSync(path.join(dir, 'docker-compose.yml')) ||
        fs.existsSync(path.join(dir, 'compose.yml'))
      ) {
        return dir;
      }
    }
    throw new Error(
      'Não foi possível localizar o docker-compose.yml. Defina AEGIS_COMPOSE_DIR.'
    );
  }

  static listLogTargets(): string[] {
    return [...ALLOWED_LOG_TARGETS];
  }

  /**
   * Returns recent logs for an allowlisted stack container.
   * Names outside the set are refused so this cannot become a free-form
   * docker logs proxy for arbitrary workloads.
   */
  static async getStackLogs(target: string, tail = 200): Promise<string> {
    const name = String(target || '').trim();
    if (!ALLOWED_LOG_TARGETS.has(name)) {
      throw new Error(
        `Alvo de log inválido. Permitidos: ${[...ALLOWED_LOG_TARGETS].join(', ')}`
      );
    }

    const containers = await dockerService.listContainers(true);
    const match = containers.find((c) => c.name === name || c.name === `/${name}`);

    if (!match) {
      throw new Error(`Contêiner "${name}" não encontrado nesta máquina.`);
    }

    const safeTail = Math.min(Math.max(Number(tail) || 200, 1), 2000);
    return dockerService.getLogs(match.id, safeTail);
  }

  /**
   * Pulls the latest images / rebuilds the panel stack.
   * Blocked in LOCAL_MODE — a local panel_db must never restart production.
   */
  static async selfUpdate(): Promise<{ ok: boolean; output: string }> {
    if (CONFIG.LOCAL_MODE) {
      throw new Error(
        'Self-update bloqueado em LOCAL_MODE. Use a VPS de produção ou defina AEGIS_LOCAL_MODE=false.'
      );
    }

    const composeDir = this.resolveComposeDir();
    const output = await this.runCompose(composeDir, ['up', '-d', '--build']);
    return { ok: true, output };
  }

  private static runCompose(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['compose', ...args], {
        cwd,
        shell: false,
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Self-update excedeu o tempo limite (10 min).'));
      }, 10 * 60 * 1000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > 512 * 1024) stdout = stdout.slice(-512 * 1024);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 512 * 1024) stderr = stderr.slice(-512 * 1024);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const combined = `${stdout}\n${stderr}`.trim();
        if (code !== 0) {
          reject(new Error(combined || `docker compose saiu com código ${code}`));
          return;
        }
        resolve(combined || 'Stack atualizada.');
      });
    });
  }
}
