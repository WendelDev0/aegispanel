import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { dbStorage } from '../src/db/storage.js';
import { DeployLogStore } from '../src/utils/deploy-log.store.js';
import { CONFIG } from '../src/config.js';

test('saveDeployment writes logs to disk and strips them from JSON metadata', () => {
  const dep = {
    id: 'dep-test-1',
    appId: 'app-test-1',
    appName: 'demo',
    branch: 'main',
    status: 'success' as const,
    buildLogs: 'linha 1\nlinha 2\nsegredo=abc',
    durationSeconds: 12,
    triggeredBy: 'manual' as const,
    createdAt: new Date().toISOString(),
  };

  const saved = dbStorage.saveDeployment(dep);
  assert.equal(saved.buildLogs.includes('linha 1'), true);

  const listed = dbStorage.getDeployments('app-test-1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].buildLogs, '');

  const fromStore = DeployLogStore.read('app-test-1', 'dep-test-1');
  assert.ok(fromStore?.includes('linha 2'));

  const viaApi = dbStorage.getDeploymentLogs('app-test-1', 'dep-test-1');
  assert.equal(viaApi.includes('linha 1'), true);

  const raw = fs.readFileSync(path.join(CONFIG.DATA_DIR, 'panel_db.json'), 'utf-8');
  assert.equal(raw.includes('linha 1'), false);
});
