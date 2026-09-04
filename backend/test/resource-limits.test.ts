import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_LIMITS,
  DEFAULT_DATABASE_LIMITS,
  committedMemoryMb,
  normalizeLimits,
  overcommitWarning,
  toHostConfigLimits,
} from '../src/utils/resource-limits.js';
import { WatchdogService } from '../src/services/watchdog.service.js';

test('an absent value falls back instead of reaching Docker', () => {
  const limits = normalizeLimits(undefined);
  assert.deepEqual(limits, DEFAULT_APP_LIMITS);
});

/**
 * Docker reads Memory: 0 as "unlimited", so a user typing 0 would get the exact
 * opposite of what they asked for.
 */
test('zero and negative values do not become "unlimited"', () => {
  const zeroed = normalizeLimits({ memoryMb: 0, cpus: 0, pidsLimit: 0 });
  assert.equal(zeroed.memoryMb, DEFAULT_APP_LIMITS.memoryMb);
  assert.equal(zeroed.cpus, DEFAULT_APP_LIMITS.cpus);
  assert.equal(zeroed.pidsLimit, DEFAULT_APP_LIMITS.pidsLimit);

  const negative = normalizeLimits({ memoryMb: -512, cpus: -1, pidsLimit: -8 });
  assert.equal(negative.memoryMb, DEFAULT_APP_LIMITS.memoryMb);
});

test('a partial object keeps the fields it did not set', () => {
  const limits = normalizeLimits({ memoryMb: 2048 });
  assert.equal(limits.memoryMb, 2048);
  assert.equal(limits.cpus, DEFAULT_APP_LIMITS.cpus);
  assert.equal(limits.pidsLimit, DEFAULT_APP_LIMITS.pidsLimit);
});

test('a value under the floor is raised to a startable one', () => {
  // Docker refuses under 6 MB and no runtime starts near it; the container
  // would never boot rather than report "needs more memory".
  assert.equal(normalizeLimits({ memoryMb: 8 }).memoryMb, 64);
});

test('a database falls back to its own, larger default', () => {
  const limits = normalizeLimits(undefined, DEFAULT_DATABASE_LIMITS);
  assert.deepEqual(limits, DEFAULT_DATABASE_LIMITS);
  assert.ok(limits.memoryMb > DEFAULT_APP_LIMITS.memoryMb);
});

/**
 * Leaving MemorySwap unset lets a container use swap equal to twice its memory,
 * so a leaking process thrashes the host's disk for minutes instead of being
 * killed at its ceiling.
 */
test('swap is pinned to the memory limit', () => {
  const hostConfig = toHostConfigLimits({ memoryMb: 512, cpus: 1.5, pidsLimit: 256 });
  assert.equal(hostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(hostConfig.MemorySwap, hostConfig.Memory);
  assert.equal(hostConfig.NanoCpus, 1_500_000_000);
  assert.equal(hostConfig.PidsLimit, 256);
});

test('fractional cpus survive the round trip', () => {
  assert.equal(normalizeLimits({ cpus: 0.25 }).cpus, 0.25);
  assert.equal(toHostConfigLimits(normalizeLimits({ cpus: 0.25 })).NanoCpus, 250_000_000);
});

test('committed memory ignores workloads with no ceiling', () => {
  assert.equal(
    committedMemoryMb([{ memoryMb: 512, cpus: 1, pidsLimit: 256 }, undefined, { memoryMb: 1024, cpus: 1, pidsLimit: 256 }]),
    1536
  );
});

test('overcommit is reported only when the promises exceed the host', () => {
  assert.equal(overcommitWarning(2048, 4096), null);
  assert.equal(overcommitWarning(4096, 4096), null, 'exatamente igual não é overcommit');

  const warning = overcommitWarning(8192, 4096);
  assert.ok(warning);
  assert.equal(warning!.ratio, 2);
  assert.equal(warning!.hostTotalMb, 4096);
});

test('an unknown host size reports nothing rather than a wrong ratio', () => {
  assert.equal(overcommitWarning(8192, 0), null);
  assert.equal(overcommitWarning(8192, Number.NaN), null);
});

/**
 * `State.OOMKilled` stays true on the exit record of a container Docker has
 * already restarted, so alerting on the flag alone would re-report the same
 * kill on every sweep, forever.
 */
test('the same OOM kill is reported once', () => {
  const id = 'container-oom-a';
  assert.equal(WatchdogService.isNewOomKill(id, true, 1), true, 'primeira observação');
  assert.equal(WatchdogService.isNewOomKill(id, true, 1), false, 'mesma morte, não repete');
  assert.equal(WatchdogService.isNewOomKill(id, true, 2), true, 'reiniciou de novo = nova morte');
  WatchdogService.forget(id);
});

test('a healthy container is never reported', () => {
  const id = 'container-ok';
  assert.equal(WatchdogService.isNewOomKill(id, false, 0), false);
  assert.equal(WatchdogService.isNewOomKill(id, false, 3), false);
  WatchdogService.forget(id);
});

/**
 * Restarting the panel must not replay every historical kill as if it just
 * happened: the first sighting of a container that never restarted is silent.
 */
test('a first sighting with no restart is not news', () => {
  const id = 'container-first-boot';
  assert.equal(WatchdogService.isNewOomKill(id, true, 0), false);
  WatchdogService.forget(id);
});
