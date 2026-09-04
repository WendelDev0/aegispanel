import './setup.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  acquirePanelLock,
  releasePanelLock,
  canTakeOver,
  currentPanelLock,
  PanelLockError,
  type PanelLockInfo,
} from '../src/utils/panel-lock.js';

/**
 * Deliberately does not import db/storage.js: that module builds the storage
 * singleton at load time, which claims the lock for the whole test process and
 * would make every acquire here fail. The JsonStorage side of the guard lives
 * in panel-lock-storage.test.ts, which node:test runs in its own process.
 */

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-lock-'));
}

function writeLock(dir: string, info: PanelLockInfo, mtime?: Date): void {
  const file = path.join(dir, 'panel_db.lock');
  fs.writeFileSync(file, JSON.stringify(info), 'utf-8');
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

// A test that unexpectedly acquires must not leave the lock held for the next
// one: the failure would cascade and hide which assertion actually broke.
afterEach(() => releasePanelLock());

test('a second acquire in the same process is refused', () => {
  const dir = tempDir();
  acquirePanelLock(dir);
  try {
    assert.throws(() => acquirePanelLock(dir), PanelLockError);
  } finally {
    releasePanelLock();
  }
});

test('release lets the next acquire through and removes the file', () => {
  const dir = tempDir();
  acquirePanelLock(dir);
  releasePanelLock();

  assert.equal(fs.existsSync(path.join(dir, 'panel_db.lock')), false);
  assert.equal(currentPanelLock(), null);

  acquirePanelLock(dir);
  releasePanelLock();
});

/**
 * Uses a real child process rather than a hardcoded pid: pid 1 is init on Linux
 * but does not exist on Windows, so asserting against it passed the guard here
 * and would have shipped an untested branch.
 */
test('a lock held by a live process on this host is refused', async () => {
  const dir = tempDir();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => child.once('spawn', resolve));

  try {
    writeLock(dir, {
      pid: child.pid!,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
    });

    assert.throws(() => acquirePanelLock(dir), PanelLockError);
    assert.equal(currentPanelLock(), null, 'uma recusa não pode deixar lock pendurado');
  } finally {
    child.kill();
  }
});

/**
 * The panel would otherwise be permanently unbootable after a hard kill: the
 * lock file names a pid nobody is using any more.
 */
test('a lock whose owner is gone is taken over', () => {
  const dir = tempDir();
  writeLock(dir, {
    pid: 0x7fffffff, // out of range for a real pid on Linux and Windows
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
  });

  const info = acquirePanelLock(dir);
  assert.equal(info.pid, process.pid);
  releasePanelLock();
});

test('a corrupt lock file does not block startup', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'panel_db.lock'), 'not json', 'utf-8');

  acquirePanelLock(dir);
  releasePanelLock();
});

/**
 * Inside a container `hostname` is the container id, so after a self-update
 * recreate the new process cannot ask whether the old pid is alive — that pid
 * belonged to a container that no longer exists. Only the heartbeat can tell a
 * live owner from an abandoned file.
 */
test('an unverifiable host is judged by the heartbeat, not by pid', () => {
  const self = { pid: process.pid, hostname: os.hostname() };
  const other: PanelLockInfo = {
    pid: 999_999,
    hostname: 'other-container-id',
    acquiredAt: new Date().toISOString(),
  };

  assert.equal(canTakeOver(other, 1_000, self), false, 'heartbeat fresco = dono vivo');
  assert.equal(canTakeOver(other, 60_000, self), true, 'heartbeat parado = abandonado');
});

/**
 * A leftover file from a previous boot can name the pid this process now has.
 * Treating it as a live owner would make the panel unbootable forever.
 */
test('our own pid in a stale file is not treated as another owner', () => {
  const self = { pid: process.pid, hostname: os.hostname() };
  const reused: PanelLockInfo = { ...self, acquiredAt: new Date(0).toISOString() };

  assert.equal(canTakeOver(reused, 1_000, self), true);
});

test('no lock file at all means the lock is free', () => {
  assert.equal(canTakeOver(null, Number.POSITIVE_INFINITY), true);
});
