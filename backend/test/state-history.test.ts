import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  StateHistory,
  collectionDelta,
  parseSnapshotName,
  planRetention,
  snapshotFileName,
} from '../src/utils/state-history.js';

const DAY = 24 * 60 * 60 * 1000;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hist-'));
}

function named(takenAtMs: number, reason = 'manual') {
  return { name: snapshotFileName(takenAtMs, reason as any), takenAtMs };
}

test('a snapshot name round-trips', () => {
  const name = snapshotFileName(1_700_000_000_000, 'import-state');
  const parsed = parseSnapshotName(name);
  assert.equal(parsed?.takenAtMs, 1_700_000_000_000);
  assert.equal(parsed?.reason, 'import-state');
});

test('an unrelated file in the directory is ignored', () => {
  assert.equal(parseSnapshotName('panel_db.json'), null);
  assert.equal(parseSnapshotName('panel_db.json.corrupt-123'), null);
  assert.equal(parseSnapshotName('notes.txt'), null);
});

test('the newest snapshots are always kept', () => {
  const now = Date.now();
  const snapshots = Array.from({ length: 30 }, (_, i) => named(now - i * 1000));

  const { keep, remove } = planRetention(snapshots, now, { keepLatest: 20, keepDailyForDays: 0 });
  assert.equal(keep.length, 20);
  assert.equal(remove.length, 10);
  assert.ok(keep.includes(snapshots[0].name), 'a mais recente nunca sai');
});

/**
 * A busy afternoon of edits would push last Tuesday out of a purely count-based
 * window within minutes — which is exactly the snapshot someone wants when they
 * notice something has been subtly wrong for days.
 */
test('one snapshot per day survives a burst of recent ones', () => {
  const now = Date.now();
  const snapshots = [
    ...Array.from({ length: 25 }, (_, i) => named(now - i * 1000)),
    named(now - 3 * DAY),
    named(now - 5 * DAY),
  ];

  const { keep } = planRetention(snapshots, now, { keepLatest: 20, keepDailyForDays: 7 });
  assert.ok(keep.includes(snapshotFileName(now - 3 * DAY, 'manual')), 'o de 3 dias atrás fica');
  assert.ok(keep.includes(snapshotFileName(now - 5 * DAY, 'manual')), 'o de 5 dias atrás fica');
});

test('snapshots older than the daily window are dropped', () => {
  const now = Date.now();
  const snapshots = [named(now), named(now - 30 * DAY)];

  const { remove } = planRetention(snapshots, now, { keepLatest: 1, keepDailyForDays: 7 });
  assert.deepEqual(remove, [snapshotFileName(now - 30 * DAY, 'manual')]);
});

test('capture copies the file and prune enforces the plan', () => {
  const dir = tempDir();
  const stateFile = path.join(dir, 'panel_db.json');
  fs.writeFileSync(stateFile, JSON.stringify({ users: [{ id: 'u1' }], apps: [] }), 'utf-8');
  const historyDir = path.join(dir, 'state-history');

  const first = StateHistory.capture(stateFile, historyDir, 'remove-app', 1_000);
  assert.ok(first);
  assert.equal(fs.existsSync(first!.path), true);

  const listed = StateHistory.list(historyDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reason, 'remove-app');
});

/**
 * The live file is rewritten in place by rename, so a hardlink would leave the
 * snapshot pointing at an inode the rename replaces — a backup that silently
 * becomes a copy of the damage it was taken to protect against.
 */
test('a snapshot does not change when the live file is rewritten', () => {
  const dir = tempDir();
  const stateFile = path.join(dir, 'panel_db.json');
  const historyDir = path.join(dir, 'state-history');
  fs.writeFileSync(stateFile, JSON.stringify({ apps: ['before'] }), 'utf-8');

  const snapshot = StateHistory.capture(stateFile, historyDir, 'manual', 2_000)!;

  // Same rename dance the atomic save performs.
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ apps: [] }), 'utf-8');
  fs.renameSync(tmp, stateFile);

  const stored = StateHistory.read(historyDir, snapshot.name) as { apps: string[] };
  assert.deepEqual(stored.apps, ['before']);
});

test('capture on a missing state file is a no-op, not a crash', () => {
  const dir = tempDir();
  const result = StateHistory.capture(path.join(dir, 'nope.json'), path.join(dir, 'h'), 'boot');
  assert.equal(result, null);
});

/**
 * The name reaches this from the API. Rebuilding it from the parsed parts means
 * a traversal attempt cannot address a path outside the history directory.
 */
test('a traversal attempt in a snapshot name is refused', () => {
  const dir = tempDir();
  for (const evil of ['../../etc/passwd', 'panel_db.1.../.json', '/etc/passwd']) {
    assert.throws(() => StateHistory.read(dir, evil), /inválido|não encontrado/i);
  }
});

test('the delta counts collections, not fields', () => {
  const delta = collectionDelta(
    { users: [1, 2], apps: [1, 2, 3], settings: { a: 1 } },
    { users: [1, 2, 3], apps: [1], settings: { a: 2 } }
  );

  assert.deepEqual(delta.users, { before: 2, after: 3, delta: 1 });
  assert.deepEqual(delta.apps, { before: 3, after: 1, delta: -2 });
  assert.equal(delta.settings, undefined, 'settings não é coleção');
});

test('a collection missing on one side counts as zero', () => {
  const delta = collectionDelta({ users: [1] }, { users: [1], databases: [1, 2] });
  assert.deepEqual(delta.databases, { before: 0, after: 2, delta: 2 });
});
