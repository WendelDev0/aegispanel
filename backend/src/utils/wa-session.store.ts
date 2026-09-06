import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { phoneHash } from './phone.js';
import { jsonColumn, waDb } from './wa-db.js';
import type { FlowSessionStore, WaSession } from '../services/wa-flow-ports.js';

export type { WaSession };

const MAX_VARS_BYTES = 16_384;

interface SessionRow {
  flow_id: string;
  node_id: string;
  waiting: number;
  last_text: string;
  vars: string;
  attempts: number;
  updated_at: string;
  expires_at: string;
}

/**
 * Conversation cursor, one row per contact.
 *
 * This used to be one JSON file per contact under `wa-sessions/`, pruned by
 * re-reading the entire directory on every write. That made a hard ceiling of
 * 400 concurrent conversations: the 401st contact evicted the least recently
 * written session, so somebody lost their place mid-answer with nothing in
 * the logs. Rows expire by index now, and the ceiling is gone.
 */
export class WaSessionStore implements FlowSessionStore {
  private static legacyRoot = path.join(CONFIG.DATA_DIR, 'wa-sessions');
  private static migrated = false;

  /**
   * Moves whatever the file store still holds into the table, once.
   *
   * Sessions are short-lived, so losing them would only strand the customers
   * mid-conversation at the moment of the upgrade — which is exactly the
   * failure this store was rewritten to stop causing.
   */
  private static migrateLegacy(): void {
    if (this.migrated) return;
    this.migrated = true;
    if (!fs.existsSync(this.legacyRoot)) return;

    try {
      for (const name of fs.readdirSync(this.legacyRoot)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(this.legacyRoot, name);
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WaSession;
          // Filename was `${instance}__${phone}` with unsafe characters
          // replaced; the digits of the phone always survived that pass.
          const stem = name.slice(0, -'.json'.length);
          const cut = stem.lastIndexOf('__');
          if (cut > 0 && parsed?.flowId && parsed.nodeId) {
            const instance = stem.slice(0, cut);
            const phone = stem.slice(cut + 2);
            const expired = parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now();
            if (!expired) this.writeRow(instance, phoneHash(phone), parsed, parsed.expiresAt);
          }
        } catch {
          /* a corrupt file is one stranded conversation, not a failed boot */
        }
      }
      fs.rmSync(this.legacyRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  private static writeRow(
    instance: string,
    pHash: string,
    session: WaSession,
    expiresAt?: string
  ): void {
    const now = new Date().toISOString();
    let vars = JSON.stringify(session.vars || {});
    if (Buffer.byteLength(vars) > MAX_VARS_BYTES) {
      // A runaway http/sql capture must not turn every later write into a
      // multi-megabyte row; dropping the payload keeps the cursor usable.
      vars = '{}';
    }

    waDb()
      .prepare(
        `INSERT INTO wa_sessions
           (instance, phone_hash, flow_id, node_id, waiting, last_text, vars, attempts, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (instance, phone_hash) DO UPDATE SET
           flow_id = excluded.flow_id,
           node_id = excluded.node_id,
           waiting = excluded.waiting,
           last_text = excluded.last_text,
           vars = excluded.vars,
           attempts = excluded.attempts,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .run(
        instance,
        pHash,
        session.flowId,
        session.nodeId,
        session.waiting ? 1 : 0,
        String(session.lastText || '').slice(0, 2000),
        vars,
        Number(session.attempts || 0),
        now,
        expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString()
      );
  }

  static read(instance: string, phone: string): WaSession | null {
    this.migrateLegacy();
    const row = waDb()
      .prepare(
        `SELECT flow_id, node_id, waiting, last_text, vars, attempts, updated_at, expires_at
           FROM wa_sessions WHERE instance = ? AND phone_hash = ?`
      )
      .get(instance, phoneHash(phone)) as SessionRow | undefined;

    if (!row) return null;

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.clear(instance, phone);
      return null;
    }

    return {
      flowId: row.flow_id,
      nodeId: row.node_id,
      waiting: row.waiting === 1,
      lastText: row.last_text,
      vars: jsonColumn<Record<string, string>>(row.vars, {}),
      attempts: row.attempts,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  static write(instance: string, phone: string, session: WaSession, ttlMinutes = 30): void {
    this.migrateLegacy();
    const boundedTtl = Math.max(5, Math.min(1440, Number(ttlMinutes) || 30));
    const expiresAt = new Date(Date.now() + boundedTtl * 60 * 1000).toISOString();
    this.writeRow(instance, phoneHash(phone), session, expiresAt);
    this.prune();
  }

  static touch(instance: string, phone: string, ttlMinutes = 30): void {
    const current = this.read(instance, phone);
    if (current) this.write(instance, phone, current, ttlMinutes);
  }

  static clear(instance: string, phone: string): void {
    try {
      waDb()
        .prepare('DELETE FROM wa_sessions WHERE instance = ? AND phone_hash = ?')
        .run(instance, phoneHash(phone));
    } catch {
      /* best effort */
    }
  }

  static clearFlow(flowId: string): void {
    try {
      waDb().prepare('DELETE FROM wa_sessions WHERE flow_id = ?').run(flowId);
    } catch {
      /* best effort */
    }
  }

  /** How many conversations are mid-flow right now. Powers the flows page. */
  static activeCount(): number {
    try {
      const row = waDb()
        .prepare('SELECT COUNT(*) AS n FROM wa_sessions WHERE expires_at > ?')
        .get(new Date().toISOString()) as { n: number } | undefined;
      return Number(row?.n || 0);
    } catch {
      return 0;
    }
  }

  /** Indexed delete, not a directory scan: this runs on the message path. */
  static prune(): void {
    try {
      waDb().prepare('DELETE FROM wa_sessions WHERE expires_at <= ?').run(new Date().toISOString());
    } catch {
      /* best effort */
    }
  }

  // --- FlowSessionStore instance surface ---------------------------------
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
