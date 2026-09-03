import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppLogStore } from '../src/utils/app-log.store.js';
import { dbStorage } from '../src/db/storage.js';
import { AlertService } from '../src/services/alert.service.js';

test('AppLogStore appends and reports size', () => {
  AppLogStore.append('app-log-test', 'hello from container\n');
  assert.match(AppLogStore.read('app-log-test'), /hello from container/);
  assert.ok(AppLogStore.size('app-log-test') > 0);
  AppLogStore.removeApp('app-log-test');
  assert.equal(AppLogStore.read('app-log-test'), '');
});

test('broadcastNotification persists alert history even without outbound channels', async () => {
  await AlertService.broadcastNotification(
    'Falha no Deploy: demo',
    'porta ocupada',
    'deploy',
    true,
    { appId: 'app-alert-test' }
  );
  const list = dbStorage.getAlertHistory('app-alert-test', 10);
  assert.ok(list.some((row) => row.title.includes('Falha no Deploy')));
});
