import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { GeoIpService } from '../src/services/geoip.service.js';
import { AnalyticsService } from '../src/services/analytics.service.js';
import { CONFIG } from '../src/config.js';

test('private and reserved addresses are never sent to the geo provider', () => {
  for (const ip of [
    '127.0.0.1',
    '::1',
    '10.0.0.5',
    '192.168.1.20',
    '172.17.0.1',
    '172.31.255.254',
    '169.254.10.1',
    'fd00::1',
    '',
  ]) {
    assert.equal(GeoIpService.isPrivate(ip), true, `deveria ser privado: ${ip}`);
  }
});

test('public addresses are eligible for lookup', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '45.176.122.27', '172.15.0.1', '172.32.0.1']) {
    assert.equal(GeoIpService.isPrivate(ip), false, `deveria ser público: ${ip}`);
  }
});

test('lookup does not resolve private addresses', () => {
  assert.equal(GeoIpService.lookup('192.168.0.10'), null);
});

// ---------------------------------------------------------------------------
// Access log ingestion
// ---------------------------------------------------------------------------

interface LineOptions {
  logger?: string;
  host?: string;
  uri?: string;
  status?: number;
  duration?: number;
  size?: number;
  ip?: string;
  ua?: string;
  ts?: number;
}

/** One entry shaped exactly like Caddy's `format json` access log. */
function caddyLine(o: LineOptions = {}): string {
  return JSON.stringify({
    level: 'info',
    ts: o.ts ?? Date.now() / 1000,
    // Caddy derives the logger name from the site block that declared it, so
    // real entries are never a bare "http.log.access".
    logger: o.logger ?? 'http.log.access.log0',
    msg: 'handled request',
    request: {
      remote_ip: o.ip ?? '203.0.113.10',
      remote_port: '40299',
      client_ip: o.ip ?? '203.0.113.10',
      proto: 'HTTP/2.0',
      method: 'GET',
      host: o.host ?? 'example.test',
      uri: o.uri ?? '/',
      headers: {
        'User-Agent': [o.ua ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/154.0'],
        Referer: ['https://news.example.org/story'],
      },
      tls: { resumed: false, version: 772, cipher_suite: 4865, proto: 'h2' },
    },
    bytes_read: 0,
    user_id: '',
    duration: o.duration ?? 0.05,
    size: o.size ?? 1024,
    status: o.status ?? 200,
  });
}

function writeLog(lines: string[]): void {
  fs.writeFileSync(CONFIG.ACCESS_LOG_PATH, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Appends instead of rewriting.
 *
 * The collector keeps a byte offset into the log, so overwriting the file with
 * a longer one makes it resume from the middle and silently skip the opening
 * lines — the same behaviour the rotation test relies on.
 */
function appendLog(lines: string[]): void {
  fs.appendFileSync(CONFIG.ACCESS_LOG_PATH, lines.join('\n') + '\n', 'utf-8');
}

test('Caddy access log entries are ingested', async () => {
  writeLog([
    caddyLine({ host: 'example.test', uri: '/' }),
    caddyLine({ host: 'example.test', uri: '/sobre', status: 404 }),
    // Caddy assigns a distinct logger name per site block.
    caddyLine({ host: 'outro.test', uri: '/', logger: 'http.log.access.log3' }),
  ]);

  await AnalyticsService.refresh();

  const status = AnalyticsService.getStatus();
  // The regression this guards: the ingest compared `logger` for equality with
  // "http.log.access", which no Caddy version emits, so every line was dropped
  // while the read offset advanced past the whole file.
  assert.equal(status.totalHits, 3, 'toda linha do log deveria ter sido contada');
  assert.equal(status.domainsTracked, 2);
  assert.equal(status.lag, 0, 'o coletor deveria ter consumido o arquivo inteiro');
});

test('lines from other Caddy subsystems are ignored', async () => {
  const before = AnalyticsService.getStatus().totalHits;

  fs.appendFileSync(
    CONFIG.ACCESS_LOG_PATH,
    JSON.stringify({
      level: 'info',
      ts: Date.now() / 1000,
      logger: 'tls.obtain',
      msg: 'certificate obtained successfully',
    }) + '\n'
  );

  await AnalyticsService.refresh();
  assert.equal(AnalyticsService.getStatus().totalHits, before);
});

test('the report exposes latency percentiles, status classes and bot share', async () => {
  const before = AnalyticsService.getOverview('24h').totals.hits;

  appendLog([
    ...Array.from({ length: 90 }, () => caddyLine({ duration: 0.02, status: 200 })),
    ...Array.from({ length: 10 }, () => caddyLine({ duration: 2.0, status: 500, uri: '/lento' })),
    caddyLine({ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)', uri: '/robots.txt' }),
  ]);

  await AnalyticsService.refresh();

  const overview = AnalyticsService.getOverview('24h');
  assert.equal(overview.totals.hits, before + 101);

  // 10% of requests took 2s, so p50 must stay fast while p99 lands in the tail.
  assert.ok(overview.totals.p50 <= 50, `p50 alto demais: ${overview.totals.p50}ms`);
  assert.ok(overview.totals.p99 >= 1000, `p99 baixo demais: ${overview.totals.p99}ms`);
  assert.ok(overview.totals.errors5xx >= 10);
  assert.ok(overview.totals.bots >= 1, 'o Googlebot deveria ter sido classificado como bot');
  assert.ok(overview.totals.errorRate > 0);

  // Domains Caddy serves that no application claims still have to be visible.
  assert.ok(overview.unattributed.some((d) => d.domain === 'example.test'));
});

test('a truncated log is re-read from the start instead of being skipped', async () => {
  const before = AnalyticsService.getStatus();
  assert.ok(before.offset > 0);

  // Caddy rotates by renaming, leaving a fresh, smaller file behind.
  writeLog([caddyLine({ host: 'rotacionado.test' })]);
  await AnalyticsService.refresh();

  const after = AnalyticsService.getStatus();
  assert.ok(after.offset < before.offset, 'o offset deveria ter voltado para o novo arquivo');
  assert.ok(
    after.domainsTracked >= before.domainsTracked,
    'os agregados anteriores não devem ser descartados por uma rotação'
  );
});

test('a partially written trailing line is not parsed twice', async () => {
  writeLog([caddyLine({ host: 'parcial.test' })]);
  await AnalyticsService.refresh();
  const baseline = AnalyticsService.getStatus().totalHits;

  const half = caddyLine({ host: 'parcial.test' });
  fs.appendFileSync(CONFIG.ACCESS_LOG_PATH, half.slice(0, 60));
  await AnalyticsService.refresh();
  assert.equal(AnalyticsService.getStatus().totalHits, baseline, 'linha incompleta não deve contar');

  fs.appendFileSync(CONFIG.ACCESS_LOG_PATH, half.slice(60) + '\n');
  await AnalyticsService.refresh();
  assert.equal(AnalyticsService.getStatus().totalHits, baseline + 1, 'linha completada deve contar uma vez');
});
