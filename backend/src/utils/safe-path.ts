import fs from 'fs';
import path from 'path';

/**
 * Resolves a user-supplied relative path inside `root` and refuses anything
 * that escapes it.
 *
 * Two things a `startsWith(root)` check misses, and both are reachable here:
 *
 *  1. Sibling prefixes. With root "/app/data", the string "/app/data-evil"
 *     starts with the root but is a different directory.
 *  2. Symlinks. The builds directory holds cloned repositories, so a repo can
 *     ship a symlink pointing at /etc or at the host filesystem; the resolved
 *     string still looks contained until the link is followed.
 *
 * The real path of the nearest existing ancestor is therefore compared using
 * path segments, not string prefixes.
 */
export function resolveSafePath(root: string, relPath: string = ''): string {
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);

  // Strip leading separators so an absolute-looking input is treated as
  // relative to the root rather than replacing it.
  const cleanRel = String(relPath).replace(/^[/\\]+/, '');
  const candidate = path.resolve(realRoot, cleanRel);

  const contains = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  if (!contains(realRoot, candidate)) {
    throw new Error('Acesso negado: caminho fora do diretório permitido.');
  }

  // Follow symlinks on whatever part of the path already exists.
  let existing = candidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }

  let realExisting: string;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    realExisting = existing;
  }

  if (!contains(realRoot, realExisting)) {
    throw new Error('Acesso negado: link simbólico aponta para fora do diretório permitido.');
  }

  return candidate;
}
