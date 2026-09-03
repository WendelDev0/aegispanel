import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideUnhealthyRestart, MAX_RESTARTS_PER_HOUR } from '../src/utils/health-watchdog.js';

test('watchdog restarts after 3 consecutive unhealthy cycles', () => {
  let budget = { consecutiveUnhealthy: 0, restartTimes: [] as number[] };
  const t0 = 1_000_000;
  let d = decideUnhealthyRestart(budget, t0);
  assert.equal(d.restart, false);
  budget = d.next;
  d = decideUnhealthyRestart(budget, t0 + 8_000);
  assert.equal(d.restart, false);
  budget = d.next;
  d = decideUnhealthyRestart(budget, t0 + 16_000);
  assert.equal(d.restart, true);
  assert.equal(d.exhausted, false);
});

test('watchdog stops after 3 restarts in one hour', () => {
  const now = 10_000_000;
  let budget = { consecutiveUnhealthy: 2, restartTimes: [now - 1000, now - 2000, now - 3000] };
  const d = decideUnhealthyRestart(budget, now);
  assert.equal(d.restart, false);
  assert.equal(d.exhausted, true);
  assert.equal(d.next.restartTimes.length, MAX_RESTARTS_PER_HOUR);
});
