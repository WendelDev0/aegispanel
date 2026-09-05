import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

const MAX_SESSIONS = 400;
const MAX_FILE_BYTES = 16_384;

export interface WaSession {
  flowId: string;
  nodeId: string;
  waiting: boolean;
  lastText: string;
  vars: Record<string, string>;
  updatedAt: string;
}

/**
 * Conversation cursor on disk, not in panel_db.json.
 *
 * Chat state grows with every inbound message. Keeping it in the panel
 * document would rewrite the whole file on each WhatsApp ping.
 */
export class WaSessionStore {
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
      return parsed;
    } catch {
      return null;
    }
  }

  static write(instance: string, phone: string, session: WaSession): void {
    if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = this.fileFor(instance, phone);
    const payload = JSON.stringify(session);
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
    this.prune();
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
    const files = fs
      .readdirSync(this.root)
      .filter((n) => n.endsWith('.json'))
      .map((name) => {
        const file = path.join(this.root, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          /* skip */
        }
        return { file, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);

    const overflow = files.length - MAX_SESSIONS;
    if (overflow <= 0) return;
    for (const entry of files.slice(0, overflow)) {
      try {
        fs.unlinkSync(entry.file);
      } catch {
        /* best effort */
      }
    }
  }
}
