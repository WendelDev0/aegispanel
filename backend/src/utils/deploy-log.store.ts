import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

/**
 * Stores CI/CD build logs as individual files under DATA_DIR/deploy-logs.
 *
 * Keeping multi-hundred-KB log strings inside panel_db.json was the main cause
 * of unbounded growth: every deploy rewrote the whole document, and prune only
 * truncated after the fact. File-backed logs leave the JSON as metadata.
 */
export class DeployLogStore {
  private static root = path.join(CONFIG.DATA_DIR, 'deploy-logs');

  private static ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private static appDir(appId: string): string {
    const safe = appId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.root, safe);
  }

  private static filePath(appId: string, deploymentId: string): string {
    const safeDep = deploymentId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.appDir(appId), `${safeDep}.log`);
  }

  static write(appId: string, deploymentId: string, content: string): void {
    const dir = this.appDir(appId);
    this.ensureDir(dir);
    const target = this.filePath(appId, deploymentId);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, target);
  }

  static read(appId: string, deploymentId: string): string | null {
    const target = this.filePath(appId, deploymentId);
    try {
      if (!fs.existsSync(target)) return null;
      return fs.readFileSync(target, 'utf-8');
    } catch {
      return null;
    }
  }

  static remove(appId: string, deploymentId: string): void {
    const target = this.filePath(appId, deploymentId);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      /* best effort */
    }
  }

  static removeApp(appId: string): void {
    const dir = this.appDir(appId);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
