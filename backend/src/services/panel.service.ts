import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config.js';
import { dockerService } from './docker.service.js';
import { emit } from '../realtime.js';
import { updateComposeCheckout } from '../utils/panel-update.js';

/** Only these container name prefixes may be tailed through PanelService. */
const ALLOWED_LOG_TARGETS = new Set([
  'aegis-backend',
  'aegis-frontend',
  'aegis-caddy',
  'aegis-nginx',
]);

const COMPOSE_FILENAMES = ['docker-compose.yml', 'compose.yml'] as const;

export type SelfUpdateEvent = {
  line: string;
  status: 'running' | 'success' | 'failed';
  done?: boolean;
};

function hasComposeFile(dir: string): boolean {
  return COMPOSE_FILENAMES.some((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * Operations against the panel's own Compose stack.
 *
 * Self-update rebuilds the stack from the compose directory. It is refused in
 * LOCAL_MODE so a developer copy cannot pull and restart the production
 * containers sitting on a shared Docker socket.
 */
export class PanelService {
  private static updating = false;

  static hasComposeFile(dir: string): boolean {
    return hasComposeFile(dir);
  }

  static resolveComposeDir(): string {
    const fromEnv = process.env.AEGIS_COMPOSE_DIR?.trim();
    if (fromEnv) {
      const dir = path.resolve(fromEnv);
      if (!hasComposeFile(dir)) {
        throw new Error(
          `AEGIS_COMPOSE_DIR aponta para "${dir}", mas docker-compose.yml (ou compose.yml) não foi encontrado. ` +
            `Ajuste a variável no .env para o diretório do clone (ex: /opt/aegispanel).`
        );
      }
      return dir;
    }

    // Default: repo root is one level above backend cwd when running from source,
    // or the install path `/opt/aegispanel` when packaged.
    const candidates = [
      path.resolve(process.cwd(), '..'),
      process.cwd(),
      '/opt/aegispanel',
    ];
    for (const dir of candidates) {
      if (hasComposeFile(dir)) return dir;
    }
    throw new Error(
      'Não foi possível localizar o docker-compose.yml. ' +
        'Defina AEGIS_COMPOSE_DIR no .env para o diretório do compose ' +
        '(o install.sh grava isso automaticamente).'
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
   * Fetches the configured Git ref, then rebuilds the stack.
   * Blocked in LOCAL_MODE — a local panel_db must never restart production.
   * Chunks are also emitted on `panel:self-update` so the UI can stream.
   */
  static async selfUpdate(): Promise<{ ok: boolean; output: string }> {
    if (CONFIG.LOCAL_MODE) {
      throw new Error(
        'Self-update bloqueado em LOCAL_MODE. Use a VPS de produção ou defina AEGIS_LOCAL_MODE=false.'
      );
    }

    if (this.updating) {
      throw new Error('Já existe um self-update em andamento.');
    }

    this.updating = true;
    const composeDir = this.resolveComposeDir();
    this.emitUpdate({
      line: `[aegis] Compose: ${composeDir}\n`,
      status: 'running',
    });

    try {
      const git = await updateComposeCheckout(composeDir, {
        onOutput: (chunk) => this.emitUpdate({ line: chunk, status: 'running' }),
      });
      if (git.skippedReason === 'no-git') {
        this.emitUpdate({
          line: `[aegis] Sem .git em ${composeDir}; rebuild da cópia que já está no disco.\n`,
          status: 'running',
        });
      } else {
        this.emitUpdate({
          line: `[aegis] git: ${git.ref} atualizado.\n[aegis] docker compose up -d --build\n`,
          status: 'running',
        });
      }

      const output = await this.runCompose(composeDir, ['up', '-d', '--build'], (chunk) => {
        this.emitUpdate({ line: chunk, status: 'running' });
      });
      const combined = [git.output, output].filter(Boolean).join('\n');
      const safe = this.redactPanelSecrets(combined);
      this.emitUpdate({ line: `\n[aegis] Concluído.\n`, status: 'success', done: true });
      return { ok: true, output: safe };
    } catch (err: any) {
      const message = this.redactPanelSecrets(err.message || String(err));
      this.emitUpdate({ line: `\n[aegis] Falhou: ${message}\n`, status: 'failed', done: true });
      throw err;
    } finally {
      this.updating = false;
    }
  }

  /** Strips panel secrets if compose ever echoes them. */
  static redactPanelSecrets(text: string): string {
    let safe = text;
    for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY'] as const) {
      const value = process.env[key];
      if (value && value.length >= 8) {
        safe = safe.split(value).join('***');
      }
    }
    return safe;
  }

  private static emitUpdate(event: SelfUpdateEvent): void {
    emit('panel:self-update', {
      ...event,
      line: this.redactPanelSecrets(event.line),
    });
  }

  private static runCompose(
    cwd: string,
    args: string[],
    onOutput?: (chunk: string) => void
  ): Promise<string> {
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

      const consume = (chunk: Buffer, bucket: 'stdout' | 'stderr') => {
        const text = chunk.toString();
        if (bucket === 'stdout') {
          stdout += text;
          if (stdout.length > 512 * 1024) stdout = stdout.slice(-512 * 1024);
        } else {
          stderr += text;
          if (stderr.length > 512 * 1024) stderr = stderr.slice(-512 * 1024);
        }
        onOutput?.(text);
      };

      child.stdout.on('data', (chunk) => consume(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => consume(chunk, 'stderr'));
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
