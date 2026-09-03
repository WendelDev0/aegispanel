import './setup.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dbStorage, type AppRecord } from '../src/db/storage.js';
import { PortService } from '../src/services/port.service.js';
import { CicdService } from '../src/services/cicd.service.js';

function sampleApp(overrides: Partial<AppRecord>): AppRecord {
  const now = new Date().toISOString();
  return {
    id: 'app-port-test',
    name: 'bomdebolao',
    sourceType: 'git',
    gitUrl: 'https://github.com/example/repo.git',
    branch: 'main',
    containerId: 'aaaaaaaaaaaa000000000000000000000000000000000000000000000000',
    port: 61201,
    internalPort: 3000,
    autoPort: false,
    env: {},
    status: 'running',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

afterEach(() => {
  for (const app of dbStorage.getApps()) {
    if (app.id.startsWith('app-port-test')) dbStorage.removeApp(app.id);
  }
});

describe('PortService redeploy of the same app', () => {
  it('treats the app own host port as free when excluding that app', async () => {
    const app = sampleApp({});
    dbStorage.saveApp(app);

    // This is the bomdebolao failure: a pinned port is always in the panel
    // records, so a redeploy used to see the app fighting itself.
    assert.equal(await PortService.isAvailable(app.port, app.containerId, { excludeAppId: app.id }), true);
    assert.equal(await PortService.describeConflict(app.port, app.containerId, { excludeAppId: app.id }), null);
  });

  it('also ignores the matching container id on the panel record', async () => {
    const app = sampleApp({ id: 'app-port-test-cid' });
    dbStorage.saveApp(app);

    assert.equal(await PortService.isAvailable(app.port, app.containerId), true);
    assert.equal(await PortService.describeConflict(app.port, app.containerId), null);
  });

  it('still reports a different app holding the same port', async () => {
    const holder = sampleApp({ id: 'app-port-test-holder', name: 'outra', containerId: 'bbbbbbbbbbbb' });
    const redeploying = sampleApp({
      id: 'app-port-test-other',
      name: 'nova',
      port: 61202,
      containerId: 'cccccccccccc',
    });
    dbStorage.saveApp(holder);
    dbStorage.saveApp(redeploying);

    assert.equal(
      await PortService.isAvailable(holder.port, redeploying.containerId, { excludeAppId: redeploying.id }),
      false
    );
    const conflict = await PortService.describeConflict(holder.port, redeploying.containerId, {
      excludeAppId: redeploying.id,
    });
    assert.match(conflict || '', /outra/);
  });
});

describe('CicdService.abandonInFlightDeploys', () => {
  it('marks leftover building rows as failed', () => {
    const app = sampleApp({ id: 'app-port-test-abandon' });
    dbStorage.saveApp(app);
    dbStorage.saveDeployment({
      id: 'dep-abandon-test-1',
      appId: app.id,
      appName: app.name,
      branch: 'main',
      status: 'building',
      buildLogs: 'pipeline started\n',
      durationSeconds: 0,
      triggeredBy: 'manual',
      createdAt: new Date().toISOString(),
    });

    const abandoned = CicdService.abandonInFlightDeploys();
    assert.ok(abandoned >= 1);

    const dep = dbStorage.getDeploymentById(app.id, 'dep-abandon-test-1');
    assert.equal(dep?.status, 'failed');
    assert.ok(dep?.finishedAt);
    assert.match(dbStorage.getDeploymentLogs(app.id, 'dep-abandon-test-1'), /reiniciou/);
  });
});
