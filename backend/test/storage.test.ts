import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStorage } from '../src/db/storage.js';

test('rejects an import payload that is not an object', () => {
  assert.ok(dbStorage.validateState(null).length > 0);
  assert.ok(dbStorage.validateState('texto').length > 0);
  assert.ok(dbStorage.validateState([]).length > 0);
});

test('requires at least one valid user', () => {
  assert.ok(dbStorage.validateState({}).some((p) => p.includes('users')));
  assert.ok(dbStorage.validateState({ users: [] }).some((p) => p.includes('users')));
  assert.ok(
    dbStorage.validateState({ users: [{ id: 'x' }] }).some((p) => p.includes('passwordHash'))
  );
});

test('rejects an unknown role', () => {
  const problems = dbStorage.validateState({
    users: [{ id: 'u1', username: 'admin', passwordHash: 'hash', role: 'superuser' }],
  });
  assert.ok(problems.some((p) => p.includes('perfil inválido')));
});

test('rejects a collection that is not a list', () => {
  const problems = dbStorage.validateState({
    users: [{ id: 'u1', username: 'admin', passwordHash: 'hash', role: 'admin' }],
    apps: { not: 'a list' },
  });
  assert.ok(problems.some((p) => p.includes('apps')));
});

test('accepts a well-formed payload', () => {
  const problems = dbStorage.validateState({
    users: [{ id: 'u1', username: 'admin', passwordHash: 'hash', role: 'admin' }],
    apps: [],
    settings: { serverName: 'Teste' },
  });
  assert.deepEqual(problems, []);
});

test('import fills in defaults for collections the payload omits', () => {
  const imported = dbStorage.importState({
    users: [{ id: 'u1', username: 'admin', passwordHash: 'hash', role: 'admin', createdAt: '2026-01-01' }],
  } as any);

  assert.equal(imported.users.length, 1);
  assert.ok(Array.isArray(imported.apps));
  assert.ok(Array.isArray(imported.firewallRules));
  // Nested defaults must survive an older export that predates these fields.
  assert.equal(typeof imported.settings.alertConfig.diskThresholdPercent, 'number');
});

test('exported state is a copy, not a live reference', () => {
  const snapshot = dbStorage.exportState();
  snapshot.users.push({
    id: 'intruso',
    username: 'intruso',
    passwordHash: 'x',
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  assert.ok(!dbStorage.getUsers().some((u) => u.id === 'intruso'));
});
