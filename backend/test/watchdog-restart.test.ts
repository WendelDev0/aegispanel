import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { WatchdogService } from '../src/services/watchdog.service.js';

/**
 * The failure this covers happened in production: an app whose recorded
 * containerId no longer existed made the watchdog retry a restart every 30s,
 * failing identically each time and printing the same stack trace, while the
 * audit log recorded each attempt as a success that never occurred.
 */

const permanent = (message: string) =>
  (WatchdogService as unknown as {
    isPermanentRestartFailure(m: string): boolean;
  }).isPermanentRestartFailure(message);

test('an unmanaged or missing container is a permanent failure', () => {
  // The exact message the Docker service raises for a container the panel does
  // not own, which is what a stale containerId produces.
  assert.equal(permanent('Contêiner não gerenciado pelo AegisPanel.'), true);
  assert.equal(permanent('No such container: abc123'), true);
  assert.equal(permanent('(HTTP code 404) no such container'), true);
});

test('a transient docker error is not permanent', () => {
  assert.equal(permanent('connect ECONNREFUSED /var/run/docker.sock'), false);
  assert.equal(permanent('read ETIMEDOUT'), false);
  assert.equal(permanent(''), false);
});

test('the nginx config resolves the backend per request, not once at boot', () => {
  // Regression guard for the outage that locked the operator out of the panel:
  // a literal name in proxy_pass is resolved once and cached for the life of
  // the worker, so recreating the backend leaves nginx dialling a dead address
  // and every API call answers 502.
  const conf = fs.readFileSync(
    path.join(process.cwd(), '..', 'frontend', 'nginx.conf'),
    'utf-8'
  );

  assert.match(conf, /resolver\s+127\.0\.0\.11/, 'precisa do DNS embutido do Docker');
  assert.doesNotMatch(
    conf,
    /proxy_pass\s+http:\/\/backend:4000/,
    'nome literal em proxy_pass volta a cachear o IP do backend'
  );
  assert.match(conf, /proxy_pass\s+http:\/\/\$aegis_backend\//, 'API via variável');
  assert.match(conf, /proxy_pass\s+http:\/\/\$aegis_backend_ws\//, 'socket.io via variável');
});
