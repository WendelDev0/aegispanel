import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonStorage } from '../src/db/storage.js';
import { PanelLockError, currentPanelLock } from '../src/utils/panel-lock.js';

/**
 * Kept in its own file: importing db/storage.js builds the storage singleton at
 * module load, which claims the writer lock for the whole process. That is
 * exactly the state this suite needs, and exactly the state the pure lock unit
 * tests must not be in.
 */

test('importing the storage singleton claims the writer lock', () => {
  const lock = currentPanelLock();
  assert.ok(lock, 'o singleton deve manter o lock');
  assert.equal(lock!.pid, process.pid);
});

/**
 * The guard that matters in production. Two writers over one panel_db.json do
 * not corrupt it — each save is atomic — they each hold the whole document in
 * memory and rewrite it wholesale, so the last one to save silently discards
 * the other's records. `dr-restore` and `reset-admin` used to run this way,
 * next to a live daemon.
 */
test('a second JsonStorage over the same DATA_DIR throws', () => {
  assert.throws(() => new JsonStorage(), PanelLockError);
});
