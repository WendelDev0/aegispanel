import fs from 'fs';
import path from 'path';

/**
 * Point-in-time copies of panel_db.json, taken before destructive changes.
 *
 * The atomic write already guarantees the file is never half-written, and a
 * corrupt file is quarantined instead of reset. Neither helps against the
 * failure that actually happens: a *valid* save that is wrong. Importing a
 * state export from the wrong server, or deleting the wrong app, produces a
 * perfectly well-formed document with the previous contents gone — and the
 * whole document is rewritten on every mutation, so the previous version is
 * gone from disk within seconds.
 *
 * A leaf module: retention is pure and tested directly, and the panel state
 * singleton must not depend on a service to protect itself.
 */

const FILE_PREFIX = 'panel_db.';
const FILE_SUFFIX = '.json';

/** Reasons a snapshot is taken. Recorded in the filename for the UI. */
export type SnapshotReason =
  | 'import-state'
  | 'restore-panel-state'
  | 'remove-app'
  | 'remove-database'
  | 'save-settings'
  | 'schema-migration'
  | 'boot'
  | 'manual';

export interface SnapshotFile {
  name: string;
  path: string;
  takenAtMs: number;
  reason: SnapshotReason | 'unknown';
  sizeBytes: number;
}

const NAME = /^panel_db\.(\d+)\.([a-z-]+)\.json$/;

export function snapshotFileName(takenAtMs: number, reason: SnapshotReason): string {
  return `${FILE_PREFIX}${takenAtMs}.${reason}${FILE_SUFFIX}`;
}

export function parseSnapshotName(name: string): { takenAtMs: number; reason: string } | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const takenAtMs = Number(match[1]);
  if (!Number.isFinite(takenAtMs)) return null;
  return { takenAtMs, reason: match[2] };
}

/**
 * Which snapshots to keep.
 *
 * Two windows, because they answer different questions. "I just broke
 * something, undo it" needs the last handful regardless of age. "This has been
 * subtly wrong since Tuesday" needs one per day going back a week — and a busy
 * afternoon of edits would otherwise push Tuesday out of a purely count-based
 * window within minutes.
 *
 * Pure so the rule is tested directly rather than by creating files.
 */
export function planRetention(
  snapshots: Array<{ name: string; takenAtMs: number }>,
  nowMs: number,
  options: { keepLatest?: number; keepDailyForDays?: number } = {}
): { keep: string[]; remove: string[] } {
  const keepLatest = options.keepLatest ?? 20;
  const keepDailyForDays = options.keepDailyForDays ?? 7;

  const newestFirst = [...snapshots].sort((a, b) => b.takenAtMs - a.takenAtMs);
  const keep = new Set<string>();

  for (const snapshot of newestFirst.slice(0, keepLatest)) {
    keep.add(snapshot.name);
  }

  // One per calendar day, the oldest of that day: it is the one that predates
  // whatever went wrong during it.
  const dailyCutoff = nowMs - keepDailyForDays * 24 * 60 * 60 * 1000;
  const oldestPerDay = new Map<string, { name: string; takenAtMs: number }>();
  for (const snapshot of newestFirst) {
    if (snapshot.takenAtMs < dailyCutoff) continue;
    const day = new Date(snapshot.takenAtMs).toISOString().slice(0, 10);
    const current = oldestPerDay.get(day);
    if (!current || snapshot.takenAtMs < current.takenAtMs) {
      oldestPerDay.set(day, snapshot);
    }
  }
  for (const snapshot of oldestPerDay.values()) keep.add(snapshot.name);

  return {
    keep: newestFirst.filter((s) => keep.has(s.name)).map((s) => s.name),
    remove: newestFirst.filter((s) => !keep.has(s.name)).map((s) => s.name),
  };
}

export class StateHistory {
  /**
   * Copies the current state file into the history directory.
   *
   * Copy, never move or hardlink: the live file is about to be rewritten in
   * place by rename, and a hardlink would leave the snapshot pointing at an
   * inode the rename replaces — a backup that silently becomes a copy of the
   * damage it was taken to protect against.
   */
  static capture(
    stateFilePath: string,
    historyDir: string,
    reason: SnapshotReason,
    nowMs = Date.now()
  ): SnapshotFile | null {
    if (!fs.existsSync(stateFilePath)) return null;

    fs.mkdirSync(historyDir, { recursive: true, mode: 0o700 });
    const name = snapshotFileName(nowMs, reason);
    const target = path.join(historyDir, name);

    try {
      fs.copyFileSync(stateFilePath, target);
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(target, 0o600);
        } catch {
          /* best effort */
        }
      }
      const stat = fs.statSync(target);
      return { name, path: target, takenAtMs: nowMs, reason, sizeBytes: stat.size };
    } catch (err: any) {
      // Never fatal. Refusing the mutation because its safety net could not be
      // written would be a worse failure than proceeding without one.
      console.warn(`Não foi possível gravar snapshot do estado (${reason}): ${err?.message}`);
      return null;
    }
  }

  static list(historyDir: string): SnapshotFile[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(historyDir);
    } catch {
      return [];
    }

    const snapshots: SnapshotFile[] = [];
    for (const name of entries) {
      const parsed = parseSnapshotName(name);
      if (!parsed) continue;
      const full = path.join(historyDir, name);
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(full).size;
      } catch {
        continue;
      }
      snapshots.push({
        name,
        path: full,
        takenAtMs: parsed.takenAtMs,
        reason: parsed.reason as SnapshotReason,
        sizeBytes,
      });
    }

    return snapshots.sort((a, b) => b.takenAtMs - a.takenAtMs);
  }

  static prune(historyDir: string, nowMs = Date.now()): string[] {
    const snapshots = this.list(historyDir);
    const { remove } = planRetention(snapshots, nowMs);

    const removed: string[] = [];
    for (const name of remove) {
      try {
        fs.unlinkSync(path.join(historyDir, name));
        removed.push(name);
      } catch {
        /* best effort */
      }
    }
    return removed;
  }

  static read(historyDir: string, name: string): unknown {
    // The name comes from the API. Reconstructing it from the parsed parts
    // rather than joining the caller's string means a traversal attempt cannot
    // reach a path outside the history directory at all.
    const parsed = parseSnapshotName(name);
    if (!parsed) throw new Error('Nome de snapshot inválido.');
    const safeName = snapshotFileName(parsed.takenAtMs, parsed.reason as SnapshotReason);
    const full = path.join(historyDir, safeName);
    if (!fs.existsSync(full)) throw new Error('Snapshot não encontrado.');
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  }
}

/**
 * What changed between two states, counted per collection.
 *
 * Counts rather than a field-level diff: the question in front of a rollback
 * button is "does this snapshot still have my 12 apps", and a full diff of a
 * multi-megabyte document answers it far less clearly.
 */
export function collectionDelta(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { before: number; after: number; delta: number }> {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const result: Record<string, { before: number; after: number; delta: number }> = {};

  for (const key of keys) {
    const beforeValue = (before || {})[key];
    const afterValue = (after || {})[key];
    if (!Array.isArray(beforeValue) && !Array.isArray(afterValue)) continue;

    const beforeCount = Array.isArray(beforeValue) ? beforeValue.length : 0;
    const afterCount = Array.isArray(afterValue) ? afterValue.length : 0;
    result[key] = { before: beforeCount, after: afterCount, delta: afterCount - beforeCount };
  }

  return result;
}
