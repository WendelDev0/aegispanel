import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampAppLimits,
  clampHealthcheck,
  describeMemoryOvercommit,
  healthcheckProbeCommand,
  sanitizeHealthcheckPath,
  toDockerHealthcheck,
  toDockerResources,
  DEFAULT_APP_LIMITS,
} from '../src/utils/resource-limits.js';

test('clampAppLimits uses 512/1/256 defaults and clamps extremes', () => {
  assert.deepEqual(clampAppLimits(undefined), DEFAULT_APP_LIMITS);
  assert.equal(clampAppLimits({ memoryMb: 8 }).memoryMb, 32);
  assert.equal(clampAppLimits({ memoryMb: 99_000 }).memoryMb, 65_536);
  assert.equal(clampAppLimits({ cpus: 0 }).cpus, 0.1);
  assert.equal(clampAppLimits({ pidsLimit: 1 }).pidsLimit, 16);
});

test('toDockerResources sets MemorySwap equal to Memory and NanoCpus from cpus', () => {
  const resources = toDockerResources({ memoryMb: 128, cpus: 0.5, pidsLimit: 64 });
  assert.equal(resources.Memory, 128 * 1024 * 1024);
  assert.equal(resources.MemorySwap, resources.Memory);
  assert.equal(resources.NanoCpus, 500_000_000);
  assert.equal(resources.PidsLimit, 64);
});

test('healthcheck probe rejects injection in the path and uses wget then curl', () => {
  assert.equal(sanitizeHealthcheckPath('/health'), '/health');
  assert.equal(sanitizeHealthcheckPath('health; rm -rf /'), '/');
  assert.equal(sanitizeHealthcheckPath('$(reboot)'), '/');
  const cmd = healthcheckProbeCommand(3000, clampHealthcheck({ path: '/ready' }));
  assert.match(cmd, /wget -qO- http:\/\/127\.0\.0\.1:3000\/ready/);
  assert.match(cmd, /curl -sf http:\/\/127\.0\.0\.1:3000\/ready/);
  const docker = toDockerHealthcheck(clampHealthcheck({ path: '/ready', intervalSec: 30, timeoutSec: 5, retries: 3 }), 3000);
  assert.deepEqual(docker.Test[0], 'CMD-SHELL');
  assert.equal(docker.Interval, 30 * 1e9);
  assert.equal(docker.Timeout, 5 * 1e9);
  assert.equal(docker.Retries, 3);
});

test('describeMemoryOvercommit warns when sum exceeds host RAM and does not block', () => {
  const warning = describeMemoryOvercommit({
    hostMemoryMb: 1024,
    planned: [
      { name: 'a', memoryMb: 512 },
      { name: 'b', memoryMb: 600 },
    ],
  });
  assert.match(warning || '', /ultrapassa/);
  assert.equal(
    describeMemoryOvercommit({
      hostMemoryMb: 4096,
      planned: [{ name: 'a', memoryMb: 512 }],
    }),
    undefined
  );
});
