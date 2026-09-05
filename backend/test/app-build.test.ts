import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeRelPath,
  matchTagGlob,
  resolveBuildConfig,
  normalizeProcess,
} from '../src/utils/app-build.js';

test('manual wins over toml and detector', () => {
  const resolved = resolveBuildConfig(
    { runtime: 'python', version: '3.12', startCommand: 'uvicorn app:app', source: 'manual' },
    { runtime: 'node', version: '20', startCommand: 'npm start' },
    { runtime: 'node', version: '18', startCommand: 'node index.js' }
  );
  assert.equal(resolved.runtime, 'python');
  assert.equal(resolved.version, '3.12');
  assert.equal(resolved.startCommand, 'uvicorn app:app');
  assert.equal(resolved.sourceByField.runtime, 'manual');
  assert.equal(resolved.sourceByField.startCommand, 'manual');
});

test('toml wins when the operator did not set the field', () => {
  const resolved = resolveBuildConfig(
    { runtime: 'python', source: 'manual' },
    { version: '3.11', startCommand: 'gunicorn app:app' },
    { version: '3.10', startCommand: 'python app.py' }
  );
  assert.equal(resolved.version, '3.11');
  assert.equal(resolved.sourceByField.version, 'toml');
  assert.equal(resolved.startCommand, 'gunicorn app:app');
});

test('rejects a path that walks out of the clone', () => {
  assert.throws(() => assertSafeRelPath('../etc'), /inválido|relativo/);
  assert.throws(() => assertSafeRelPath('/etc/passwd'), /relativo/);
});

test('accepts a monorepo subfolder', () => {
  assert.equal(assertSafeRelPath('apps/api'), 'apps/api');
});

test('rejects a version outside the allowlist', () => {
  assert.throws(
    () => resolveBuildConfig({ runtime: 'python', version: '2.7', source: 'manual' }, undefined, undefined),
    /não é permitida/
  );
});

test('v* matches production tags and not a random branch', () => {
  assert.equal(matchTagGlob('v1.2.0', 'v*'), true);
  assert.equal(matchTagGlob('release-v1', 'v*'), false);
});

test('cron processes require a schedule', () => {
  assert.throws(
    () => normalizeProcess({ name: 'beat', type: 'cron', command: 'true' }),
    /schedule/
  );
});
