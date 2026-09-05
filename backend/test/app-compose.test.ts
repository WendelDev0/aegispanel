import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompose } from '../src/utils/app-compose.js';

const ROOT = '/data/apps/app-1/volumes';

test('rejects privileged and the docker socket', () => {
  const plan = validateCompose(
    `
services:
  app:
    image: nginx
    privileged: true
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`,
    ROOT
  );
  assert.equal(plan.ok, false);
  assert.ok(plan.blocked.some((b) => b.code === 'privileged'));
  assert.ok(plan.blocked.some((b) => b.code === 'docker_socket'));
});

test('rejects a host bind outside the app folder', () => {
  const plan = validateCompose(
    `
services:
  app:
    image: nginx
    volumes:
      - /etc/passwd:/etc/passwd
`,
    ROOT
  );
  assert.equal(plan.ok, false);
  assert.ok(plan.blocked.some((b) => b.code === 'host_bind'));
});

test('accepts a named volume and lists services', () => {
  const plan = validateCompose(
    `
services:
  app:
    image: nginx
    ports:
      - "8080:80"
  redis:
    image: redis:7
`,
    ROOT
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.services.length, 2);
  assert.ok(plan.rewrittenPorts.length > 0);
});
