import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

const MAX_FILE_BYTES = 1_500_000;
const ROTATED_COPIES = 2;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

/**
 * Runtime container logs on disk, separate from CI/CD build logs.
 *
 * Docker only keeps a live ring buffer. Without a file here, reopening the
 * modal after a container recreate showed nothing, and there was no disk cap.
 */
export class AppLogStore {
  private static root = path.join(CONFIG.DATA_DIR, 'app-logs');

  private static appDir(appId: string): string {
    const safe = appId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.root, safe);
  }

  private static currentPath(appId: string): string {
    return path.join(this.appDir(appId), 'runtime.log');
  }

  static size(appId: string): number {
    return this.dirSize(this.appDir(appId));
  }

  static totalBytes(): number {
    if (!fs.existsSync(this.root)) return 0;
    let total = 0;
    try {
      for (const name of fs.readdirSync(this.root)) {
        total += this.dirSize(path.join(this.root, name));
      }
    } catch {
      return total;
    }
    return total;
  }

  static read(appId: string): string {
    const dir = this.appDir(appId);
    if (!fs.existsSync(dir)) return '';
    const parts: string[] = [];
    for (let i = ROTATED_COPIES; i >= 1; i--) {
      const rotated = path.join(dir, `runtime.log.${i}`);
      if (fs.existsSync(rotated)) {
        try {
          parts.push(fs.readFileSync(rotated, 'utf-8'));
        } catch {
          /* skip unreadable rotation */
        }
      }
    }
    const current = this.currentPath(appId);
    if (fs.existsSync(current)) {
      try {
        parts.push(fs.readFileSync(current, 'utf-8'));
      } catch {
        /* skip */
      }
    }
    return parts.join('');
  }

  static append(appId: string, chunk: string): void {
    if (!chunk) return;
    const dir = this.appDir(appId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = this.currentPath(appId);
    fs.appendFileSync(target, chunk.endsWith('\n') ? chunk : `${chunk}\n`, { encoding: 'utf-8' });
    this.rotateIfNeeded(appId);
    this.pruneGlobal();
  }

  static removeApp(appId: string): void {
    const dir = this.appDir(appId);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  private static rotateIfNeeded(appId: string): void {
    const current = this.currentPath(appId);
    let size = 0;
    try {
      size = fs.statSync(current).size;
    } catch {
      return;
    }
    if (size < MAX_FILE_BYTES) return;

    const dir = this.appDir(appId);
    const oldest = path.join(dir, `runtime.log.${ROTATED_COPIES}`);
    try {
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    } catch {
      /* best effort */
    }
    for (let i = ROTATED_COPIES - 1; i >= 1; i--) {
      const from = path.join(dir, `runtime.log.${i}`);
      const to = path.join(dir, `runtime.log.${i + 1}`);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(current, path.join(dir, 'runtime.log.1'));
  }

  private static pruneGlobal(): void {
    if (!fs.existsSync(this.root)) return;
    const dirs = fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const dir = path.join(this.root, d.name);
        return { dir, mtime: this.dirMtime(dir), size: this.dirSize(dir) };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let total = dirs.reduce((sum, d) => sum + d.size, 0);
    for (const entry of dirs) {
      if (total <= MAX_TOTAL_BYTES) break;
      try {
        fs.rmSync(entry.dir, { recursive: true, force: true });
        total -= entry.size;
      } catch {
        /* best effort */
      }
    }
  }

  private static dirSize(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const name of fs.readdirSync(dir)) {
      try {
        total += fs.statSync(path.join(dir, name)).size;
      } catch {
        /* skip */
      }
    }
    return total;
  }

  private static dirMtime(dir: string): number {
    try {
      return fs.statSync(dir).mtimeMs;
    } catch {
      return 0;
    }
  }
}
