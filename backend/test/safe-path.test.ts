import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSafePath } from '../src/utils/safe-path.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-safe-'));
fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'ok');

test('resolves paths inside the root', () => {
  assert.equal(resolveSafePath(root, 'sub/file.txt'), path.join(fs.realpathSync(root), 'sub', 'file.txt'));
  assert.equal(resolveSafePath(root, ''), fs.realpathSync(root));
});

test('rejects traversal out of the root', () => {
  assert.throws(() => resolveSafePath(root, '../escape'), /Acesso negado/);
  assert.throws(() => resolveSafePath(root, 'sub/../../escape'), /Acesso negado/);
  assert.throws(() => resolveSafePath(root, '....//....//etc/passwd'), /Acesso negado/);
});

test('treats an absolute-looking input as relative to the root', () => {
  const resolved = resolveSafePath(root, '/etc/passwd');
  assert.equal(resolved, path.join(fs.realpathSync(root), 'etc', 'passwd'));
});

test('rejects a sibling directory sharing the root prefix', () => {
  // The bug a startsWith() check misses: "<root>-evil" begins with "<root>"
  // but is a different directory.
  const sibling = `${root}-evil`;
  fs.mkdirSync(sibling, { recursive: true });
  try {
    assert.throws(() => resolveSafePath(root, `../${path.basename(sibling)}/secret`), /Acesso negado/);
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('rejects a symlink pointing outside the root', { skip: process.platform === 'win32' }, () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'confidencial');
  const linkPath = path.join(root, 'link');

  try {
    fs.symlinkSync(outside, linkPath, 'dir');
  } catch {
    return; // unprivileged environment; nothing to assert
  }

  try {
    assert.throws(() => resolveSafePath(root, 'link/secret.txt'), /Acesso negado/);
  } finally {
    fs.rmSync(linkPath, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
