import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { redactSecrets } from './redact.js';

export interface AuditEvent {
  ts: string;
  actor?: { id: string; username: string; role: string };
  sid?: string;
  ip?: string;
  action: string;
  target?: { type?: string; id?: string; name?: string };
  outcome: 'success' | 'failure' | 'forbidden' | 'unauthenticated';
  meta?: Record<string, unknown>;
}

/**
 * Append-only audit log outside panel_db.json.
 *
 * A JSON document can be rewritten; a monthly jsonl file can only grow. That
 * is the property we want for "who did what": an administrator who can edit
 * panel state still cannot silently erase that they did it without deleting
 * files on disk, which itself leaves a trail.
 */
export class AuditStore {
  private static root = path.join(CONFIG.DATA_DIR, 'audit');

  static dir(): string {
    return this.root;
  }

  private static fileFor(at = new Date()): string {
    const stamp = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
    return path.join(this.root, `${stamp}.jsonl`);
  }

  static append(event: Omit<AuditEvent, 'ts'> & { ts?: string }): void {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const record: AuditEvent = {
      ...event,
      ts: event.ts || new Date().toISOString(),
      meta: event.meta ? this.redactMeta(event.meta) : undefined,
    };
    // Redact the serialised line as well: a secret that slipped into `action`
    // or `target` must not survive on disk.
    const line = redactSecrets(JSON.stringify(record)) + '\n';
    fs.appendFileSync(this.fileFor(), line, { encoding: 'utf-8', mode: 0o600 });
  }

  static query(opts: {
    from?: Date;
    to?: Date;
    actor?: string;
    action?: string;
    limit?: number;
  }): AuditEvent[] {
    if (!fs.existsSync(this.root)) return [];
    const files = fs
      .readdirSync(this.root)
      .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse();

    const fromMs = opts.from?.getTime() ?? 0;
    const toMs = opts.to?.getTime() ?? Date.now() + 60_000;
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
    const out: AuditEvent[] = [];
    const actionNeedle = opts.action?.trim().toLowerCase();

    for (const file of files) {
      let raw = '';
      try {
        raw = fs.readFileSync(path.join(this.root, file), 'utf-8');
      } catch {
        continue;
      }
      const lines = raw.trim() ? raw.trim().split('\n') : [];
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const ev = JSON.parse(lines[i]) as AuditEvent;
          const ts = Date.parse(ev.ts);
          if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue;
          if (opts.actor && ev.actor?.username !== opts.actor && ev.actor?.id !== opts.actor) continue;
          if (actionNeedle && !ev.action.toLowerCase().includes(actionNeedle)) continue;
          out.push(ev);
          if (out.length >= limit) return out;
        } catch {
          /* skip a truncated last line */
        }
      }
    }
    return out;
  }

  static listFiles(): string[] {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root)
      .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
      .sort();
  }

  /**
   * Copies current monthly files into destDir (used by panel-state backups).
   */
  static snapshotTo(destDir: string): number {
    const files = this.listFiles();
    if (!files.length) return 0;
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    for (const file of files) {
      fs.copyFileSync(path.join(this.root, file), path.join(destDir, file));
    }
    return files.length;
  }

  /**
   * Drops monthly files older than `retainMonths`. Copies them into archiveDir
   * first so a panel backup taken before prune still has the history.
   */
  static archiveAndPrune(retainMonths = 12, archiveDir?: string): number {
    const files = this.listFiles();
    if (!files.length) return 0;
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - retainMonths);
    const cutoffStamp = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}`;
    let removed = 0;
    for (const file of files) {
      const stamp = file.replace(/\.jsonl$/, '');
      if (stamp >= cutoffStamp) continue;
      const src = path.join(this.root, file);
      if (archiveDir) {
        fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
        fs.copyFileSync(src, path.join(archiveDir, file));
      }
      fs.unlinkSync(src);
      removed++;
    }
    return removed;
  }

  private static redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
    try {
      return JSON.parse(redactSecrets(JSON.stringify(meta))) as Record<string, unknown>;
    } catch {
      return { redacted: true };
    }
  }
}
