import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

/**
 * Active human handoffs, on disk.
 *
 * This lived in a plain Map. A panel restart — a self-update, a redeploy, an
 * OOM — dropped every active handoff silently, and the bot started answering
 * over an attendant who was mid-conversation with a customer. The operator
 * had no way to tell: nothing logs a Map that vanished.
 *
 * Reads happen on every inbound message, so the map stays in memory and disk
 * is only touched when a handoff starts or ends, which is rare.
 */
const MAX_HANDOFFS = 500;

let cache: Map<string, number> | null = null;

function filePath(): string {
  return path.join(CONFIG.DATA_DIR, 'wa-handoffs.json');
}

function prune(map: Map<string, number>): Map<string, number> {
  const now = Date.now();
  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) map.delete(key);
  }
  // Map preserves insertion order; drop the oldest first.
  if (map.size > MAX_HANDOFFS) {
    const overflow = map.size - MAX_HANDOFFS;
    let dropped = 0;
    for (const key of map.keys()) {
      map.delete(key);
      dropped += 1;
      if (dropped >= overflow) break;
    }
  }
  return map;
}

function load(): Map<string, number> {
  if (cache) return cache;
  const map = new Map<string, number>();
  try {
    const file = filePath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const entries = parsed?.handoffs;
      if (entries && typeof entries === 'object') {
        for (const [key, value] of Object.entries(entries)) {
          const expiresAt = Number(value);
          if (Number.isFinite(expiresAt)) map.set(key, expiresAt);
        }
      }
    }
  } catch {
    // A corrupt file must not keep the panel from answering. Losing the
    // handoffs here is the same failure the store exists to fix, but at
    // least it is bounded to one bad file rather than every restart.
  }
  cache = prune(map);
  return cache;
}

function persist(map: Map<string, number>): void {
  try {
    const dir = path.dirname(filePath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ handoffs: Object.fromEntries(map) });
    const tmp = `${filePath()}.tmp`;
    fs.writeFileSync(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, filePath());
  } catch {
    /* a handoff that fails to persist still holds for this process */
  }
}

export class WaHandoffStore {
  static key(instance: string, phoneHash: string): string {
    return `${instance}__${phoneHash}`;
  }

  static set(instance: string, phoneHash: string, expiresAt: number): void {
    const map = load();
    map.set(this.key(instance, phoneHash), expiresAt);
    persist(prune(map));
  }

  static isActive(instance: string, phoneHash: string): boolean {
    const map = load();
    const key = this.key(instance, phoneHash);
    const expiresAt = map.get(key);
    if (!expiresAt) return false;
    if (Date.now() >= expiresAt) {
      map.delete(key);
      persist(map);
      return false;
    }
    return true;
  }

  static release(instance: string, phoneHash: string): boolean {
    const map = load();
    const existed = map.delete(this.key(instance, phoneHash));
    if (existed) persist(map);
    return existed;
  }

  static list(): Array<{ instance: string; phoneHash: string; expiresAt: string }> {
    const map = prune(load());
    return [...map.entries()].map(([key, expiresAt]) => {
      const separator = key.indexOf('__');
      return {
        instance: separator > 0 ? key.slice(0, separator) : key,
        phoneHash: separator > 0 ? key.slice(separator + 2) : '',
        expiresAt: new Date(expiresAt).toISOString(),
      };
    });
  }

  static clear(): void {
    cache = new Map();
    persist(cache);
  }

  /** Test seam: forces the next read to come from disk. */
  static resetCache(): void {
    cache = null;
  }
}
