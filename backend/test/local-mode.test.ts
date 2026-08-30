import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';

/**
 * setup.ts sets NODE_ENV=test, which is the situation that matters: anything
 * that is not explicitly production must be treated as a development copy.
 */
test('local mode is on by default outside production', () => {
  assert.equal(CONFIG.LOCAL_MODE, true);
});

test('outbound alerts stay off unless explicitly allowed', () => {
  assert.equal(CONFIG.ALLOW_OUTBOUND_ALERTS, false);
});
