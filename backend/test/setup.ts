import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Test environment.
 *
 * Imported first by every suite: config.ts resolves secrets at module load and
 * would otherwise generate and persist an .env.local into the repository.
 * DATA_DIR is redirected to a temporary directory so a test run can never
 * touch a real panel_db.json.
 */
export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-test-'));

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY = 'test-encryption-key-abcdef0123456789abcdef0123';
process.env.DATA_DIR = TEST_DATA_DIR;
// Analytics reads this path at module load; point it inside the temp dir so a
// suite can write a synthetic Caddy log without touching a real one.
process.env.ACCESS_LOG_PATH = path.join(TEST_DATA_DIR, 'access.log');

export function cleanup(): void {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
