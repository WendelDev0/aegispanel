import { EncryptionService } from './crypto.js';
import { digits, phoneHash, phoneTail } from './phone.js';
import { jsonColumn, waDb } from './wa-db.js';

export interface WaContact {
  instance: string;
  phoneHash: string;
  phoneTail: string;
  pushName: string;
  attrs: Record<string, string>;
  tags: string[];
  firstSeen: string;
  lastSeen: string;
  lastFlowId?: string;
  inboundCount: number;
  optedOut: boolean;
}

export interface WaHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface ContactRow {
  instance: string;
  phone_hash: string;
  phone_tail: string;
  push_name: string;
  attrs: string;
  tags: string;
  first_seen: string;
  last_seen: string;
  last_flow_id: string | null;
  inbound_count: number;
  opted_out: number;
}

const MAX_ATTRS = 40;
const MAX_TAGS = 20;
const MAX_HISTORY_ROWS = 60;

function toContact(row: ContactRow): WaContact {
  return {
    instance: row.instance,
    phoneHash: row.phone_hash,
    phoneTail: row.phone_tail,
    pushName: row.push_name,
    attrs: jsonColumn<Record<string, string>>(row.attrs, {}),
    tags: jsonColumn<string[]>(row.tags, []),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastFlowId: row.last_flow_id || undefined,
    inboundCount: row.inbound_count,
    optedOut: row.opted_out === 1,
  };
}

/**
 * The person on the other end, remembered between conversations.
 *
 * Flow variables live in the session and die with its TTL — thirty minutes by
 * default. Everything a `capture` block collected was therefore thrown away
 * the moment the customer went quiet, and `saveLead` was a checkbox on two
 * shipped templates that no code ever read. Attributes stored here outlive
 * the session, which is what makes segmentation, follow-ups and a returning
 * customer's "you already told us that" possible.
 *
 * The number itself is encrypted at rest and never leaves the API: callers
 * get `phoneTail` for recognition, and only the sending path decrypts, so a
 * leaked panel_db.json or an exported contact list carries no phone book.
 */
export class WaContactStore {
  /** Upsert on every inbound message. Returns the contact as it now stands. */
  static touch(
    instance: string,
    phone: string,
    details?: { pushName?: string; flowId?: string }
  ): WaContact {
    const pHash = phoneHash(phone);
    const now = new Date().toISOString();
    const name = String(details?.pushName || '').slice(0, 80);

    waDb()
      .prepare(
        `INSERT INTO wa_contacts
           (instance, phone_hash, phone_tail, phone_enc, push_name, attrs, tags,
            first_seen, last_seen, last_flow_id, inbound_count, opted_out)
         VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, ?, ?, 1, 0)
         ON CONFLICT (instance, phone_hash) DO UPDATE SET
           last_seen = excluded.last_seen,
           inbound_count = wa_contacts.inbound_count + 1,
           last_flow_id = COALESCE(excluded.last_flow_id, wa_contacts.last_flow_id),
           -- Evolution omits pushName on some payloads; an empty one must not
           -- erase the name the first message taught us.
           push_name = CASE WHEN excluded.push_name = '' THEN wa_contacts.push_name ELSE excluded.push_name END`
      )
      .run(
        instance,
        pHash,
        phoneTail(phone),
        EncryptionService.encrypt(digits(phone)),
        name,
        now,
        now,
        details?.flowId ?? null
      );

    return this.get(instance, pHash)!;
  }

  static get(instance: string, pHash: string): WaContact | null {
    const row = waDb()
      .prepare('SELECT * FROM wa_contacts WHERE instance = ? AND phone_hash = ?')
      .get(instance, pHash) as unknown as ContactRow | undefined;
    return row ? toContact(row) : null;
  }

  /**
   * The real number, for the send path only.
   *
   * Kept off `WaContact` on purpose: anything that merely reads a contact
   * cannot leak what it never received.
   */
  static revealPhone(instance: string, pHash: string): string | null {
    const row = waDb()
      .prepare('SELECT phone_enc FROM wa_contacts WHERE instance = ? AND phone_hash = ?')
      .get(instance, pHash) as { phone_enc: string } | undefined;
    if (!row?.phone_enc) return null;
    return EncryptionService.tryDecrypt(row.phone_enc) ?? null;
  }

  /** Merges attributes; an empty value deletes the key. */
  static setAttrs(instance: string, pHash: string, patch: Record<string, string>): WaContact | null {
    const current = this.get(instance, pHash);
    if (!current) return null;

    const attrs = { ...current.attrs };
    for (const [rawKey, rawValue] of Object.entries(patch)) {
      const key = String(rawKey).slice(0, 32);
      if (!key) continue;
      const value = String(rawValue ?? '');
      if (!value) delete attrs[key];
      else attrs[key] = value.slice(0, 500);
    }

    const trimmed = Object.fromEntries(Object.entries(attrs).slice(0, MAX_ATTRS));
    waDb()
      .prepare('UPDATE wa_contacts SET attrs = ? WHERE instance = ? AND phone_hash = ?')
      .run(JSON.stringify(trimmed), instance, pHash);

    return this.get(instance, pHash);
  }

  static setTags(instance: string, pHash: string, tags: string[]): WaContact | null {
    const clean = Array.from(
      new Set(tags.map((t) => String(t).trim().toLowerCase().slice(0, 32)).filter(Boolean))
    ).slice(0, MAX_TAGS);
    waDb()
      .prepare('UPDATE wa_contacts SET tags = ? WHERE instance = ? AND phone_hash = ?')
      .run(JSON.stringify(clean), instance, pHash);
    return this.get(instance, pHash);
  }

  static addTag(instance: string, pHash: string, tag: string): WaContact | null {
    const current = this.get(instance, pHash);
    if (!current) return null;
    return this.setTags(instance, pHash, [...current.tags, tag]);
  }

  static removeTag(instance: string, pHash: string, tag: string): WaContact | null {
    const current = this.get(instance, pHash);
    if (!current) return null;
    const want = String(tag).trim().toLowerCase();
    return this.setTags(instance, pHash, current.tags.filter((t) => t !== want));
  }

  static setOptOut(instance: string, pHash: string, optedOut: boolean): WaContact | null {
    waDb()
      .prepare('UPDATE wa_contacts SET opted_out = ? WHERE instance = ? AND phone_hash = ?')
      .run(optedOut ? 1 : 0, instance, pHash);
    return this.get(instance, pHash);
  }

  static remove(instance: string, pHash: string): void {
    const db = waDb();
    db.prepare('DELETE FROM wa_messages WHERE instance = ? AND phone_hash = ?').run(instance, pHash);
    db.prepare('DELETE FROM wa_contacts WHERE instance = ? AND phone_hash = ?').run(instance, pHash);
  }

  /**
   * Filtered roster. `tag` and `attr` filter in SQL against the JSON columns
   * so a segment does not load every contact into memory to count itself.
   */
  static list(options?: {
    instance?: string;
    tag?: string;
    search?: string;
    optedOut?: boolean;
    limit?: number;
    offset?: number;
  }): { contacts: WaContact[]; total: number } {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.instance) {
      where.push('instance = ?');
      params.push(options.instance);
    }
    if (options?.tag) {
      // The tags column is a JSON array of lowercase strings, so a quoted
      // match cannot hit a longer tag that merely starts the same way.
      where.push('tags LIKE ?');
      params.push(`%"${String(options.tag).trim().toLowerCase()}"%`);
    }
    if (options?.search) {
      where.push('(push_name LIKE ? OR phone_tail LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search}%`);
    }
    if (options?.optedOut !== undefined) {
      where.push('opted_out = ?');
      params.push(options.optedOut ? 1 : 0);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = waDb();

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM wa_contacts ${clause}`)
      .get(...params) as { n: number } | undefined;

    const limit = Math.max(1, Math.min(200, options?.limit || 50));
    const offset = Math.max(0, options?.offset || 0);
    const rows = db
      .prepare(`SELECT * FROM wa_contacts ${clause} ORDER BY last_seen DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as ContactRow[];

    return { contacts: rows.map(toContact), total: Number(totalRow?.n || 0) };
  }

  /** Every distinct tag with its contact count, for the segment picker. */
  static tagCounts(instance?: string): Array<{ tag: string; count: number }> {
    const { contacts } = this.list({ instance, limit: 200 });
    const counts = new Map<string, number>();
    for (const contact of contacts) {
      for (const tag of contact.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  // --- conversation history ----------------------------------------------

  /**
   * What the AI block reads back as memory.
   *
   * Turn logs could not serve this: they are per flow, hold a 240-character
   * excerpt, and are read by scanning a JSONL file from the end. Memory needs
   * the contact's own thread, whole messages, and an indexed read.
   */
  static appendMessage(
    instance: string,
    pHash: string,
    role: 'user' | 'assistant',
    content: string,
    flowId?: string
  ): void {
    const text = String(content || '').trim();
    if (!text) return;

    const db = waDb();
    db.prepare(
      'INSERT INTO wa_messages (instance, phone_hash, role, content, at, flow_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(instance, pHash, role, text.slice(0, 4000), new Date().toISOString(), flowId ?? null);

    // Ring buffer per contact: memory is bounded by `memoryTurns` anyway, and
    // an unbounded table would grow with every message the panel ever saw.
    db.prepare(
      `DELETE FROM wa_messages
        WHERE instance = ? AND phone_hash = ?
          AND id <= (
            SELECT id FROM wa_messages
             WHERE instance = ? AND phone_hash = ?
             ORDER BY id DESC LIMIT 1 OFFSET ?
          )`
    ).run(instance, pHash, instance, pHash, MAX_HISTORY_ROWS);
  }

  static history(instance: string, pHash: string, limit = 12): WaHistoryEntry[] {
    const rows = waDb()
      .prepare(
        `SELECT role, content, at FROM wa_messages
          WHERE instance = ? AND phone_hash = ?
          ORDER BY id DESC LIMIT ?`
      )
      .all(instance, pHash, Math.max(1, Math.min(MAX_HISTORY_ROWS, limit))) as Array<{
      role: string;
      content: string;
      at: string;
    }>;

    return rows
      .reverse()
      .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content, at: r.at }));
  }

  static clearHistory(instance: string, pHash: string): void {
    waDb().prepare('DELETE FROM wa_messages WHERE instance = ? AND phone_hash = ?').run(instance, pHash);
  }
}
