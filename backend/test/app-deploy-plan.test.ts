import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planDeployStrategy } from '../src/utils/app-deploy-plan.js';

test('healthcheck and domain alone cannot enable the unsafe blue-green executor', () => {
  const plan = planDeployStrategy({ hasHealthcheck: true, hasDomain: true });
  assert.equal(plan.strategy, 'recreate');
  assert.deepEqual(plan.steps, ['release', 'recreate']);
  assert.ok(plan.warnings.some((warning) => /blue-green/i.test(warning)));
});

test('no domain falls back to recreate', () => {
  const plan = planDeployStrategy({ hasHealthcheck: true, hasDomain: false });
  assert.equal(plan.strategy, 'recreate');
  assert.ok(plan.warnings.length > 0);
});

test('no healthcheck falls back to recreate', () => {
  const plan = planDeployStrategy({ hasHealthcheck: false, hasDomain: true });
  assert.equal(plan.strategy, 'recreate');
});

test('explicit recreate is honored', () => {
  const plan = planDeployStrategy({
    requested: 'recreate',
    hasHealthcheck: true,
    hasDomain: true,
  });
  assert.equal(plan.strategy, 'recreate');
});

test('tight memory falls back to recreate', () => {
  const plan = planDeployStrategy({
    hasHealthcheck: true,
    hasDomain: true,
    memoryFitsTwice: false,
  });
  assert.equal(plan.strategy, 'recreate');
});
