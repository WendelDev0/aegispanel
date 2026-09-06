import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';

/**
 * Conversation state lives here, not in panel_db.json and no longer in one
 * file per contact.
 *
 * The file-per-contact store capped itself at 400 sessions because every
 * write re-read and re-parsed the whole directory to decide what to prune.
 * Past that ceiling the oldest file was deleted by mtime — which is to say a
 * customer mid-conversation lost their place the moment the 401st person
 * messaged, silently, with the bot answering the next message as if it had
 * never spoken.
 *
 * SQLite removes both problems at once: pruning is an indexed DELETE instead
 * of a directory scan, and the same file can hold the contact roster and the
 * message history that the AI block needs for memory. `node:sqlite` ships
 * with Node 22, so this costs no dependency and no native build step.
 */

const SCHEMA = [
  // v1 — sessions, contacts and message history.
  `
  CREATE TABLE IF NOT EXISTS wa_sessions (
    instance    TEXT NOT NULL,
    phone_hash  TEXT NOT NULL,
    flow_id     TEXT NOT NULL,
    node_id     TEXT NOT NULL,
    waiting     INTEGER NOT NULL DEFAULT 0,
    last_text   TEXT NOT NULL DEFAULT '',
    vars        TEXT NOT NULL DEFAULT '{}',
    attempts    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    PRIMARY KEY (instance, phone_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON wa_sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_flow ON wa_sessions (flow_id);

  CREATE TABLE IF NOT EXISTS wa_contacts (
    instance     TEXT NOT NULL,
    phone_hash   TEXT NOT NULL,
    phone_tail   TEXT NOT NULL DEFAULT '',
    phone_enc    TEXT NOT NULL DEFAULT '',
    push_name    TEXT NOT NULL DEFAULT '',
    attrs        TEXT NOT NULL DEFAULT '{}',
    tags         TEXT NOT NULL DEFAULT '[]',
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    last_flow_id TEXT,
    inbound_count INTEGER NOT NULL DEFAULT 0,
    opted_out    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (instance, phone_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON wa_contacts (last_seen DESC);

  CREATE TABLE IF NOT EXISTS wa_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    instance   TEXT NOT NULL,
    phone_hash TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    at         TEXT NOT NULL,
    flow_id    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_contact ON wa_messages (instance, phone_hash, id DESC);
  `,
];

let handle: DatabaseSync | null = null;
let openFailure: string | null = null;

function dbFile(): string {
  return path.join(CONFIG.DATA_DIR, 'wa.db');
}

function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 4000');
  db.exec('CREATE TABLE IF NOT EXISTS wa_schema (version INTEGER NOT NULL)');

  const row = db.prepare('SELECT MAX(version) AS v FROM wa_schema').get() as { v: number | null } | undefined;
  const current = Number(row?.v ?? 0);

  for (let version = current + 1; version <= SCHEMA.length; version += 1) {
    db.exec(SCHEMA[version - 1]);
    db.prepare('INSERT INTO wa_schema (version) VALUES (?)').run(version);
  }
}

/**
 * Opens on first use, never at import: a suite that only touches the flow
 * validator should not create a database, and `config.ts` must have resolved
 * DATA_DIR before this path is built.
 */
export function waDb(): DatabaseSync {
  if (handle) return handle;
  if (openFailure) throw new Error(openFailure);

  try {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true, mode: 0o700 });
    }
    const db = new DatabaseSync(dbFile());
    migrate(db);
    handle = db;
    return db;
  } catch (err: any) {
    // Remembered so a broken file does not retry a failing open on every
    // inbound message; the message says which file to look at.
    openFailure = `Não foi possível abrir ${dbFile()}: ${err?.message || err}`;
    throw new Error(openFailure);
  }
}

/** Flushes WAL and releases the handle. Called from the shutdown path. */
export function closeWaDb(): void {
  if (!handle) return;
  try {
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    handle.close();
  } catch {
    /* best effort: the process is going away either way */
  }
  handle = null;
}

/** Test seam: drops the handle so the next call reopens under a new DATA_DIR. */
export function resetWaDb(): void {
  closeWaDb();
  openFailure = null;
}

/**
 * Consistent copy of the conversation database, for the panel backup.
 *
 * `VACUUM INTO` is SQLite's own snapshot: it reads through the WAL and writes
 * a single finished file, so the copy is never a half-applied transaction the
 * way `cp` of a live database would be. Plain file copy is what the audit
 * snapshot can afford; this one holds the contact roster.
 */
export function snapshotWaDb(targetPath: string): void {
  if (!fs.existsSync(dbFile())) return;
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
  // The path is interpolated because VACUUM INTO takes no bind parameter; it
  // is built by the backup service from a timestamp, never from a request.
  waDb().exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
}

/**
 * Puts a snapshot back in place.
 *
 * The handle is dropped first: swapping the file under an open connection
 * leaves SQLite reading pages that no longer describe the file it has. A turn
 * in flight during the swap fails and lands on the inbound strip, which is
 * the visible outcome an operator-initiated restore should have.
 */
export function restoreWaDb(sourcePath: string): void {
  if (!fs.existsSync(sourcePath)) throw new Error(`Snapshot não encontrado: ${sourcePath}`);
  closeWaDb();

  const target = dbFile();
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.rmSync(`${target}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
  fs.copyFileSync(sourcePath, target);
  openFailure = null;
}

export function jsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
