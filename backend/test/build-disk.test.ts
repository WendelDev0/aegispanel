import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneBuildArtifacts } from '../src/utils/build-disk.js';

test('pruneBuildArtifacts deletes oldest node_modules until under cap and keeps source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-builds-'));
  try {
    const oldJunk = path.join(root, 'app-old', 'node_modules');
    const newJunk = path.join(root, 'app-new', 'node_modules');
    const source = path.join(root, 'app-old', 'src', 'index.js');
    fs.mkdirSync(oldJunk, { recursive: true });
    fs.mkdirSync(newJunk, { recursive: true });
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(path.join(oldJunk, 'pkg.js'), 'x'.repeat(400_000));
    fs.writeFileSync(path.join(newJunk, 'pkg.js'), 'x'.repeat(400_000));
    fs.writeFileSync(source, 'keep-me');
    const oldTime = new Date('2020-01-01');
    fs.utimesSync(oldJunk, oldTime, oldTime);

    const result = pruneBuildArtifacts(root, 0.5);
    assert.ok(result.removed.some((p) => p === oldJunk));
    assert.equal(fs.existsSync(oldJunk), false);
    assert.equal(fs.existsSync(source), true);
    assert.ok(result.bytesAfter < result.bytesBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
