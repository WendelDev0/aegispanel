import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import type { FlowSessionStore, WaSession } from '../services/wa-flow-ports.js';

export type { WaSession };

const MAX_SESSIONS = 400;
const MAX_FILE_BYTES = 16_384;

/**
 * Conversation cursor on disk, not in panel_db.json.
 *
 * Chat state grows with every inbound message. Keeping it in the panel
 * document would rewrite the whole file on each WhatsApp ping.
 */
export class WaSessionStore implements FlowSessionStore {
  private static root = path.join(CONFIG.DATA_DIR, 'wa-sessions');

  private static fileFor(instance: string, phone: string): string {
    const safe = `${instance}__${phone}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
    return path.join(this.root, `${safe}.json`);
  }

  static read(instance: string, phone: string): WaSession | null {
    const file = this.fileFor(instance, phone);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WaSession;
      if (!parsed?.flowId || !parsed.nodeId) return null;

      // TTL expiration check
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
        this.clear(instance, phone);
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  static write(instance: string, phone: string, session: WaSession, ttlMinutes = 30): void {
    if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = this.fileFor(instance, phone);

    const boundedTtl = Math.max(5, Math.min(1440, Number(ttlMinutes) || 30));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + boundedTtl * 60 * 1000).toISOString();

    const payloadObj: WaSession = {
      ...session,
      updatedAt: now.toISOString(),
      expiresAt,
    };

    const payload = JSON.stringify(payloadObj);
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
    this.prune();
  }

  static touch(instance: string, phone: string, ttlMinutes = 30): void {
    const current = this.read(instance, phone);
    if (current) {
      this.write(instance, phone, current, ttlMinutes);
    }
  }

  static clear(instance: string, phone: string): void {
    const file = this.fileFor(instance, phone);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* best effort */
    }
  }

  static clearFlow(flowId: string): void {
    if (!fs.existsSync(this.root)) return;
    for (const name of fs.readdirSync(this.root)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.root, name);
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WaSession;
        if (parsed.flowId === flowId) fs.unlinkSync(file);
      } catch {
        /* skip */
      }
    }
  }

  private static prune(): void {
    if (!fs.existsSync(this.root)) return;
    const now = Date.now();
    const files = fs
      .readdirSync(this.root)
      .filter((n) => n.endsWith('.json'))
      .map((name) => {
        const file = path.join(this.root, name);
        let mtime = 0;
        let expired = false;
        try {
          const stat = fs.statSync(file);
          mtime = stat.mtimeMs;
          const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WaSession;
          if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= now) {
            expired = true;
          }
        } catch {
          /* skip */
        }
        return { file, mtime, expired };
      });

    for (const f of files) {
      if (f.expired) {
        try { fs.unlinkSync(f.file); } catch { /* best effort */ }
      }
    }

    const remaining = files.filter((f) => !f.expired).sort((a, b) => a.mtime - b.mtime);
    const overflow = remaining.length - MAX_SESSIONS;
    if (overflow <= 0) return;
    for (const entry of remaining.slice(0, overflow)) {
      try {
        fs.unlinkSync(entry.file);
      } catch {
        /* best effort */
      }
    }
  }

  // Instance interface methods for FlowSessionStore
  read(instance: string, phone: string): WaSession | null {
    return WaSessionStore.read(instance, phone);
  }

  write(instance: string, phone: string, session: WaSession, ttlMinutes?: number): void {
    return WaSessionStore.write(instance, phone, session, ttlMinutes);
  }

  clear(instance: string, phone: string): void {
    return WaSessionStore.clear(instance, phone);
  }

  clearFlow(flowId: string): void {
    return WaSessionStore.clearFlow(flowId);
  }
}
