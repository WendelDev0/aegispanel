import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_DATA_DIR } from './setup.js';
import { CONFIG } from '../src/config.js';
import { dbStorage, type AppRecord } from '../src/db/storage.js';
import { AppService } from '../src/services/app.service.js';
import { CaddyService } from '../src/services/caddy.service.js';
import { HealthService } from '../src/services/health.service.js';

test('a failed Caddy reload restores the last configuration on disk', async (t) => {
  t.mock.method(dbStorage, 'getApps', () => []);
  t.mock.method(dbStorage, 'getDomains', () => []);
  t.mock.method(dbStorage, 'getSettings', () => ({}));
  t.mock.method(CaddyService, 'reload', async () => ({ success: false, message: 'invalid candidate' }));
  const caddy = CaddyService as unknown as { caddyfilePath: string };
  const previous = caddy.caddyfilePath;
  caddy.caddyfilePath = path.join(TEST_DATA_DIR, 'restore-Caddyfile');
  fs.writeFileSync(caddy.caddyfilePath, '# last known configuration\n');
  t.after(() => { caddy.caddyfilePath = previous; });
  await assert.rejects(CaddyService.syncCaddyfile(), /invalid candidate/);
  assert.equal(fs.readFileSync(caddy.caddyfilePath, 'utf8'), '# last known configuration\n');
});

test('apps without custom domains receive the same stable HTTPS URL in API and Caddy', async (t) => {
  const config = CONFIG as typeof CONFIG & { APPS_BASE_DOMAIN?: string };
  const previousBase = config.APPS_BASE_DOMAIN;
  config.APPS_BASE_DOMAIN = 'apps.example.com';
  t.after(() => { config.APPS_BASE_DOMAIN = previousBase; });
  const app = { id: 'app-stable-id', name: 'api', port: 4512, internalPort: 3000, env: {} } as AppRecord;
  t.mock.method(dbStorage, 'getApps', () => [app]);
  t.mock.method(dbStorage, 'getDomains', () => []);
  t.mock.method(dbStorage, 'getSettings', () => ({}));
  t.mock.method(CaddyService, 'reload', async () => ({ success: true, message: 'test' }));
  const caddy = CaddyService as unknown as { caddyfilePath: string };
  const previous = caddy.caddyfilePath;
  caddy.caddyfilePath = path.join(TEST_DATA_DIR, 'automatic-Caddyfile');
  t.after(() => { caddy.caddyfilePath = previous; });
  const exposed = AppService.toPublic(app) as ReturnType<typeof AppService.toPublic> & { publicUrl?: string };
  assert.ok(exposed.publicUrl, 'API must provide the URL; the browser cannot invent it');
  const url = new URL(exposed.publicUrl);
  assert.equal(url.protocol, 'https:');
  assert.ok(url.hostname.endsWith('.apps.example.com'));
  assert.equal(url.port, '');
  const content = await CaddyService.syncCaddyfile();
  assert.ok(content.includes(`${url.hostname} {`));
  assert.match(content, /reverse_proxy aegis-app-api:3000/);
  assert.equal((AppService.toPublic({ ...app, name: 'renamed' }) as typeof exposed).publicUrl, exposed.publicUrl);
});

test('Caddy and readiness both address the active release', async (t) => {
  const app = { id: 'app-test', name: 'api', port: 4511, internalPort: 8080, domain: 'api.example.com', activeContainerName: 'aegis-app-api--release2' } as AppRecord;
  t.mock.method(dbStorage, 'getApps', () => [app]);
  t.mock.method(dbStorage, 'getDomains', () => []);
  t.mock.method(dbStorage, 'getSettings', () => ({}));
  t.mock.method(CaddyService, 'reload', async () => ({ success: true, message: 'test' }));
  const caddy = CaddyService as unknown as { caddyfilePath: string };
  const previous = caddy.caddyfilePath;
  caddy.caddyfilePath = path.join(TEST_DATA_DIR, 'active-Caddyfile');
  t.after(() => { caddy.caddyfilePath = previous; });
  const content = await CaddyService.syncCaddyfile();
  assert.match(content, /reverse_proxy aegis-app-api--release2:8080/);
  assert.equal(HealthService.targetUrl(app, HealthService.config(app)), 'http://aegis-app-api--release2:8080/');
});
