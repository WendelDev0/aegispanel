import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import {
  DEFAULT_HEALTHCHECK,
  decideRestart,
  MAX_RESTARTS_PER_HOUR,
  normalizeHealthcheck,
  shouldRouteTraffic,
  toDockerHealthcheck,
  UNHEALTHY_CYCLES_BEFORE_RESTART,
} from '../src/utils/health-probe.js';
import { HealthService } from '../src/services/health.service.js';

test('an absent config falls back to the defaults', () => {
  assert.deepEqual(normalizeHealthcheck(undefined), DEFAULT_HEALTHCHECK);
});

/**
 * The path is interpolated into a CMD-SHELL healthcheck that the container runs
 * every interval, so a value carrying a command substitution would be live code
 * inside the container. It is rejected, not escaped.
 */
test('a path carrying shell syntax is rejected, not escaped', () => {
  for (const evil of ['/;id', '/$(id)', '/`id`', '/a"b', "/a'b", '/a b', '/a|b', '/a\nb']) {
    assert.equal(
      normalizeHealthcheck({ path: evil }).path,
      '/',
      `deveria recusar ${JSON.stringify(evil)}`
    );
  }
});

test('an ordinary path with a query string is kept', () => {
  assert.equal(normalizeHealthcheck({ path: '/api/health?probe=1' }).path, '/api/health?probe=1');
});

test('a relative path is rejected because Docker needs an absolute one', () => {
  assert.equal(normalizeHealthcheck({ path: 'health' }).path, '/');
});

test('out-of-range intervals are clamped instead of reaching Docker', () => {
  const config = normalizeHealthcheck({ intervalSec: 1, timeoutSec: 9999, retries: 99 });
  assert.equal(config.intervalSec, 5);
  assert.equal(config.timeoutSec, 120);
  assert.equal(config.retries, 10);
});

test('the docker healthcheck tries both wget and curl', () => {
  const check = toDockerHealthcheck(normalizeHealthcheck({ path: '/up' }), 8080);
  const command = check.Test[1];
  assert.equal(check.Test[0], 'CMD-SHELL');
  assert.ok(command.includes('http://127.0.0.1:8080/up'));
  assert.ok(command.includes('wget'), 'wget primeiro');
  assert.ok(command.includes('curl'), 'curl como alternativa');
  // Docker takes nanoseconds; seconds here would be a 30ns interval.
  assert.equal(check.Interval, 30 * 1_000_000_000);
  assert.equal(check.Timeout, 5 * 1_000_000_000);
});

test('the watchdog waits for consecutive failures before acting', () => {
  for (let failures = 0; failures < UNHEALTHY_CYCLES_BEFORE_RESTART; failures++) {
    const decision = decideRestart({ consecutiveFailures: failures, restartsInLastHour: 0 });
    assert.equal(decision.restart, false, `${failures} falhas não devem reiniciar`);
    assert.equal(decision.giveUp, false);
  }

  const acting = decideRestart({
    consecutiveFailures: UNHEALTHY_CYCLES_BEFORE_RESTART,
    restartsInLastHour: 0,
  });
  assert.equal(acting.restart, true);
});

/**
 * An app that crashes on boot is unhealthy again seconds after each restart, so
 * an uncapped watchdog turns one broken deploy into an endless restart loop.
 */
test('the watchdog gives up after the hourly cap', () => {
  const decision = decideRestart({
    consecutiveFailures: 10,
    restartsInLastHour: MAX_RESTARTS_PER_HOUR,
  });
  assert.equal(decision.restart, false);
  assert.equal(decision.giveUp, true);
});

/**
 * `unknown` is the state of every app right after the panel restarts, before
 * the first probe runs. Treating it as a failure would take every site offline
 * on each panel restart.
 */
test('only a known-unhealthy app is pulled out of the proxy', () => {
  assert.equal(shouldRouteTraffic('healthy'), true);
  assert.equal(shouldRouteTraffic('starting'), true);
  assert.equal(shouldRouteTraffic('unknown'), true);
  assert.equal(shouldRouteTraffic(undefined), true);
  assert.equal(shouldRouteTraffic('unhealthy'), false);
});

async function withServer(
  handler: http.RequestListener,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}/`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a 200 counts as reachable', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200);
      res.end('ok');
    },
    async (url) => {
      const result = await HealthService.probeUrl(url, 2000);
      assert.equal(result.reachable, true);
      assert.equal(result.statusCode, 200);
    }
  );
});

/**
 * An API whose `/` returns 404 is completely healthy, and it is extremely
 * common. Treating that as a failure would roll back working deploys.
 */
test('a 404 still counts as reachable', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404);
      res.end('not found');
    },
    async (url) => {
      const result = await HealthService.probeUrl(url, 2000);
      assert.equal(result.reachable, true);
      assert.equal(result.statusCode, 404);
    }
  );
});

/**
 * A 500 is an application bug the panel must surface, not paper over by
 * restarting the container underneath it.
 */
test('a 500 counts as reachable — the process is serving', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    },
    async (url) => {
      const result = await HealthService.probeUrl(url, 2000);
      assert.equal(result.reachable, true);
      assert.equal(result.statusCode, 500);
    }
  );
});

test('a refused connection is not reachable', async () => {
  // Port 1 on loopback has nothing listening on any supported platform.
  const result = await HealthService.probeUrl('http://127.0.0.1:1/', 2000);
  assert.equal(result.reachable, false);
  assert.ok(result.error);
});

test('a server that never answers times out instead of hanging', async () => {
  await withServer(
    () => {
      // Deliberately never responds.
    },
    async (url) => {
      const result = await HealthService.probeUrl(url, 300);
      assert.equal(result.reachable, false);
      assert.match(result.error || '', /Sem resposta/);
    }
  );
});

test('waitUntilReady gives up at the deadline and reports the last error', async () => {
  const app = {
    id: 'app-x',
    name: 'nao-existe',
    internalPort: 1,
    port: 1,
    healthcheck: { path: '/', intervalSec: 5, timeoutSec: 1, retries: 1 },
  } as any;

  const started = Date.now();
  const result = await HealthService.waitUntilReady(app, { timeoutMs: 900, intervalMs: 100 });

  assert.equal(result.ready, false);
  assert.ok(result.attempts >= 1);
  assert.ok(result.lastError);
  assert.ok(Date.now() - started < 5000, 'não pode exceder muito o deadline');
});
