import fs from 'fs';
import path from 'path';

const JUNK_DIR_NAMES = new Set(['node_modules', '.next', 'dist']);

/**
 * Recursive on-disk size. Symlinks are skipped so a loop cannot make the
 * cap check hang or follow a bind that lives outside DATA_DIR/builds.
 */
export function directorySizeBytes(root: string): number {
  if (!root || !fs.existsSync(root)) return 0;
  let total = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      } catch {
        /* skip unreadable */
      }
    }
  };
  walk(root);
  return total;
}

interface JunkDir {
  path: string;
  mtimeMs: number;
  size: number;
}

function collectJunkDirs(root: string): JunkDir[] {
  const found: JunkDir[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (JUNK_DIR_NAMES.has(entry.name)) {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        found.push({ path: full, mtimeMs, size: directorySizeBytes(full) });
        continue;
      }
      walk(full);
    }
  };
  walk(root);
  found.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return found;
}

/**
 * Deletes node_modules / .next / dist under a builds root, oldest first,
 * until the tree is at or under capMb. Source checkouts are left in place.
 */
export function pruneBuildArtifacts(
  root: string,
  capMb: number
): { bytesBefore: number; bytesAfter: number; removed: string[] } {
  const capBytes = Math.max(1, Math.round(Number(capMb) * 1024 * 1024));
  const bytesBefore = directorySizeBytes(root);
  const removed: string[] = [];
  if (bytesBefore <= capBytes) {
    return { bytesBefore, bytesAfter: bytesBefore, removed };
  }

  const junk = collectJunkDirs(root);
  let bytesAfter = bytesBefore;
  for (const dir of junk) {
    if (bytesAfter <= capBytes) break;
    try {
      fs.rmSync(dir.path, { recursive: true, force: true });
      removed.push(dir.path);
      bytesAfter = Math.max(0, bytesAfter - dir.size);
    } catch {
      /* best effort */
    }
  }
  return { bytesBefore, bytesAfter: directorySizeBytes(root), removed };
}
