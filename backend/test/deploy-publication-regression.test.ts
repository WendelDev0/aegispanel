import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type Docker from 'dockerode';
import { dbStorage, type AppRecord } from '../src/db/storage.js';
import { CicdService } from '../src/services/cicd.service.js';
import { NodeService } from '../src/services/node.service.js';
import { dockerService } from '../src/services/docker.service.js';
import { PortService } from '../src/services/port.service.js';
import { HealthService } from '../src/services/health.service.js';
import { CaddyService } from '../src/services/caddy.service.js';
import { AlertService } from '../src/services/alert.service.js';

test('real queued deploy never records success when route publication fails', async (t) => {
  const app = {
    id: 'app-publish-regression', name: 'api', sourceType: 'image', imageName: 'test:v2',
    port: 4515, internalPort: 3000, env: {}, status: 'running',
    domain: 'api.example.com', activeContainerName: 'aegis-app-api--old', containerId: 'old',
    healthcheck: { path: '/', intervalSec: 30, timeoutSec: 5, retries: 3 },
    deploy: { strategy: 'blue-green' },
  } as AppRecord;
  const statuses: string[] = [];
  const events: string[] = [];
  t.mock.method(NodeService, 'assertDeployTarget', async () => ({ nodeId: 'node-local', isRemote: false }));
  t.mock.method(NodeService, 'getClient', async () => ({} as Docker));
  t.mock.method(dockerService, 'testConnection', async () => true);
  t.mock.method(PortService, 'isAvailable', async () => true);
  t.mock.method(dbStorage, 'saveDeployment', ((record: any) => { statuses.push(record.status); return record; }) as any);
  t.mock.method(dbStorage, 'saveApp', ((record: any) => record) as any);
  t.mock.method(dbStorage, 'addActivity', () => undefined);
  t.mock.method(AlertService, 'broadcastNotification', () => undefined);
  t.mock.method(dockerService, 'createAndStartContainer', (async (options: any) => {
    events.push('start');
    assert.equal(options.name, 'aegis-app-api--old');
    assert.equal(options.replaceExisting, true);
    return 'new-container';
  }) as any);
  t.mock.method(dockerService, 'removeContainerByName', async () => { throw new Error('must not run the old blue-green drain'); });
  t.mock.method(HealthService, 'waitUntilReady', async () => { events.push('ready'); return { ready: true, attempts: 1 }; });
  t.mock.method(CaddyService, 'syncCaddyfile', async () => { events.push('publish'); throw new Error('proxy rejected the route'); });
  await assert.rejects(CicdService.runQueuedDeploy(app, { triggeredBy: 'manual' }, 'deploy-publication-test'), /proxy rejected the route/);
  assert.deepEqual(events, ['start', 'ready', 'publish']);
  assert.equal(statuses.includes('success'), false);
  assert.equal(statuses.at(-1), 'failed');
});
