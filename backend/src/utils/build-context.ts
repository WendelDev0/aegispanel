import fs from 'fs';
import path from 'path';

const SKIP_SEGMENT = /(?:^|\/)(?:\.git|node_modules|\.next|dist|data|backups)(?:\/|$)/;

/**
 * Relative file paths to send as a Docker build context.
 *
 * Walks the clone on the panel; the resulting tar is what dockerode uploads
 * to whichever daemon will run the image (local socket or remote SSH).
 * `.git` and install trees stay out so a remote build does not ship secrets
 * or hundreds of megabytes of dependencies the Dockerfile will reinstall.
 */
export function collectBuildContextFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    throw new Error(`Contexto de build inexistente: ${root}`);
  }

  const entries = fs.readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[];
  const files: string[] = [];
  for (const entry of entries) {
    const rel = entry.replace(/\\/g, '/');
    if (SKIP_SEGMENT.test(`/${rel}/`) || SKIP_SEGMENT.test(rel)) continue;
    const full = path.join(root, entry);
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    files.push(rel);
  }

  if (!files.some((f) => /(^|\/)Dockerfile$/i.test(f))) {
    throw new Error('O contexto de build não contém um Dockerfile.');
  }

  return files;
}
