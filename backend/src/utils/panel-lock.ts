import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Single-writer guard for panel_db.json.
 *
 * The whole panel state is one document held in memory and rewritten on every
 * mutation. Two processes pointed at the same DATA_DIR do not corrupt the file
 * — each write is atomic — they do something worse and quieter: each keeps its
 * own copy in memory and rewrites the *entire* document from it, so the last
 * writer silently discards everything the other one did. An app created in one
 * process simply disappears when the other saves.
 *
 * That is reachable today: `dr-restore` and `reset-admin` import the same
 * storage singleton and used to run via `docker compose exec` while the daemon
 * was up, and a mis-scaled `docker compose up --scale backend=2` would do the
 * same. This lock turns that from silent data loss into a refusal to boot.
 */

const LOCK_FILENAME = 'panel_db.lock';

/**
 * A lock whose heartbeat stopped this long ago is considered abandoned.
 *
 * Needed because the owner may be unverifiable: inside a container `hostname`
 * is the container id, so after a self-update recreate the new process cannot
 * ask whether the previous pid is alive — it belongs to a container that no
 * longer exists. The clean path is still the release on SIGTERM; this is the
 * fallback for a hard kill.
 */
const STALE_AFTER_MS = 30_000;
const HEARTBEAT_MS = 10_000;

export interface PanelLockInfo {
  pid: number;
  hostname: string;
  acquiredAt: string;
}

export class PanelLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelLockError';
  }
}

/** Set while this process owns a lock, so a second acquire is caught in-process. */
let held: { file: string; info: PanelLockInfo; heartbeat: NodeJS.Timeout } | null = null;
let exitHooksInstalled = false;

function lockPath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILENAME);
}

function readLock(file: string): PanelLockInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (typeof parsed?.pid !== 'number' || typeof parsed?.hostname !== 'string') return null;
    return parsed as PanelLockInfo;
  } catch {
    // Unreadable or truncated: treat as no owner rather than blocking forever
    // on a file nobody can prove belongs to a live process.
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the pid exists but belongs to another user.
    return err?.code === 'EPERM';
  }
}

function ageMs(file: string): number {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function describe(info: PanelLockInfo): string {
  return `pid ${info.pid} em "${info.hostname}" desde ${info.acquiredAt}`;
}

/**
 * Decides whether an existing lock file may be taken over.
 *
 * Exported for the test suite: the interesting cases (dead owner, reused pid,
 * unverifiable host) are pure decisions over a file's contents and age.
 */
export function canTakeOver(
  existing: PanelLockInfo | null,
  fileAgeMs: number,
  self = { pid: process.pid, hostname: os.hostname() }
): boolean {
  if (!existing) return true;

  // Our own pid, but we do not hold it in this process: a leftover file from a
  // previous boot whose pid number has since been reused. Blocking on it would
  // make the panel permanently unbootable.
  if (existing.pid === self.pid && existing.hostname === self.hostname) return true;

  // Same machine: liveness is authoritative, regardless of heartbeat age.
  if (existing.hostname === self.hostname) return !isProcessAlive(existing.pid);

  // Different host (or a recreated container): liveness cannot be checked, so
  // fall back to the heartbeat.
  return fileAgeMs >= STALE_AFTER_MS;
}

function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  // 'exit' covers a normal return and an uncaught throw; the signal handlers in
  // server.ts release explicitly before their own shutdown work.
  process.on('exit', () => releasePanelLock());
}

/**
 * Claims the writer lock for `dataDir`.
 *
 * @throws PanelLockError when another process is already writing this state.
 */
export function acquirePanelLock(dataDir: string): PanelLockInfo {
  const file = lockPath(dataDir);

  if (held) {
    throw new PanelLockError(
      `Este processo já mantém o lock de ${held.file}. ` +
        'Só pode existir uma instância de JsonStorage por processo — o estado do painel é um documento único em memória.'
    );
  }

  const info: PanelLockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
  };
  const payload = JSON.stringify(info, null, 2);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  // 'wx' fails if the file exists, so two processes racing to a first boot
  // cannot both believe they won. Only the takeover path below rewrites an
  // existing file, and it runs solely for a lock already proven abandoned.
  try {
    fs.writeFileSync(file, payload, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;

    const existing = readLock(file);
    if (!canTakeOver(existing, ageMs(file))) {
      throw new PanelLockError(
        `Outro processo já está usando ${dataDir} (${describe(existing!)}).\n` +
          'Dois processos sobre o mesmo panel_db.json sobrescrevem o estado um do outro em silêncio.\n' +
          'Pare o painel antes de rodar scripts de manutenção:  docker compose stop backend'
      );
    }
    fs.writeFileSync(file, payload, { encoding: 'utf-8', mode: 0o600 });
  }

  // Refreshes mtime so another host can tell a live owner from an abandoned
  // file. unref'd: an idle heartbeat must never keep the process alive.
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {
      // The file may have been removed by an operator; the next acquire wins.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  held = { file, info, heartbeat };
  installExitHooks();
  return info;
}

/** Releases the lock held by this process. Safe to call when none is held. */
export function releasePanelLock(): void {
  if (!held) return;
  const { file, heartbeat } = held;
  held = null;
  clearInterval(heartbeat);
  try {
    // Only remove a file that is still ours: an operator may have deleted it
    // and a different process may already own the replacement.
    const current = readLock(file);
    if (current && current.pid === process.pid) fs.unlinkSync(file);
  } catch {
    // best effort
  }
}

/** The lock this process holds, if any. */
export function currentPanelLock(): PanelLockInfo | null {
  return held ? held.info : null;
}
