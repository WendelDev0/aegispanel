import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaddyService } from '../src/services/caddy.service.js';

/**
 * `renderSite` is private to the service; reaching it here is deliberate.
 * The alternative is `syncCaddyfile`, which validates and reloads inside the
 * Caddy container and so cannot run without Docker — and the directives below
 * are exactly the kind that regress silently, because a wrong one only shows
 * up as an outage during someone else's update.
 */
function renderSite(domain: string, upstream: string): string {
  return (CaddyService as unknown as {
    renderSite: (d: string, u: string, tls: boolean, extras?: { securityHeaders?: boolean }) => string;
  }).renderSite(domain, upstream, false);
}

test('a single-upstream site does no passive health checking', () => {
  const block = renderSite('painel.exemplo.com', 'aegis-frontend:80');

  // Every site this file renders has exactly one upstream. Marking it
  // unhealthy leaves Caddy with none available, which it answers 503 — and
  // the window is re-armed by each new failure, so a panel restart used to
  // 503 for far longer than it was actually down.
  assert.equal(block.includes('fail_duration'), false, 'fail_duration transforma um 502 curto em 503 grudento');
  assert.equal(block.includes('max_fails'), false);

  // Retrying the one upstream is what actually helps a container that takes a
  // second or two to come back.
  assert.match(block, /lb_try_duration 5s/);
  assert.match(block, /lb_try_interval 250ms/);
});

test('the rendered block still proxies to the upstream it was given', () => {
  const block = renderSite('app.exemplo.com', 'aegis-app-api:3000');
  assert.match(block, /^app\.exemplo\.com \{/);
  assert.match(block, /reverse_proxy aegis-app-api:3000 \{/);
  assert.match(block, /header_up X-Forwarded-Proto \{scheme\}/);
});
