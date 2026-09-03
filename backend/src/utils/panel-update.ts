import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const GIT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Branch/tag the panel is allowed to check out. Taken from AEGIS_UPDATE_REF,
 * never from an HTTP body: an admin session pulling an attacker-controlled
 * ref would rebuild the control plane as root.
 */
export function sanitizeUpdateRef(raw: unknown, fallback = 'main'): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
  if (
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    value.endsWith('/') ||
    value.endsWith('.')
  ) {
    throw new Error('AEGIS_UPDATE_REF inválido. Use um branch ou tag Git simples, sem caminhos especiais.');
  }
  return value;
}

export function resolveUpdateRef(env: NodeJS.ProcessEnv = process.env): string {
  return sanitizeUpdateRef(env.AEGIS_UPDATE_REF, 'main');
}

export function hasComposeGit(composeDir: string): boolean {
  try {
    return fs.existsSync(path.join(composeDir, '.git'));
  } catch {
    return false;
  }
}

/**
 * argv for `git` so tests can assert there is no shell string and no `..`.
 * fetch writes FETCH_HEAD; checkout -B moves the local branch there.
 */
export function gitUpdateCommands(composeDir: string, ref: string): string[][] {
  const safe = sanitizeUpdateRef(ref);
  const prefix = ['-c', `safe.directory=${composeDir}`, '-C', composeDir];
  return [
    [...prefix, 'fetch', 'origin', safe],
    [...prefix, 'checkout', '-B', safe, 'FETCH_HEAD'],
  ];
}

export type GitRunner = (args: string[], onOutput?: (chunk: string) => void) => Promise<string>;

function spawnGit(args: string[], onOutput?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { shell: false, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('git excedeu o tempo limite (2 min) durante o self-update.'));
    }, GIT_TIMEOUT_MS);

    const consume = (chunk: Buffer, bucket: 'stdout' | 'stderr') => {
      const text = chunk.toString();
      if (bucket === 'stdout') stdout += text;
      else stderr += text;
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
        reject(new Error(combined || `git saiu com código ${code}`));
        return;
      }
      resolve(combined);
    });
  });
}

export async function updateComposeCheckout(
  composeDir: string,
  options: { ref?: string; runGit?: GitRunner; onOutput?: (chunk: string) => void } = {}
): Promise<{ pulled: boolean; ref: string; output: string; skippedReason?: 'no-git' }> {
  const ref = sanitizeUpdateRef(options.ref ?? process.env.AEGIS_UPDATE_REF, 'main');
  if (!hasComposeGit(composeDir)) {
    return {
      pulled: false,
      ref,
      output: '',
      skippedReason: 'no-git',
    };
  }

  const run = options.runGit || spawnGit;
  const commands = gitUpdateCommands(composeDir, ref);
  const parts: string[] = [];
  for (const args of commands) {
    parts.push(await run(args, options.onOutput));
  }
  return { pulled: true, ref, output: parts.filter(Boolean).join('\n') };
}
