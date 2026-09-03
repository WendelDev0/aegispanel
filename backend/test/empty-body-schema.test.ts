import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBodySchema } from '../src/validation/schemas.js';

test('emptyBodySchema accepts missing, null and empty object bodies', () => {
  assert.deepEqual(emptyBodySchema.parse(undefined), {});
  assert.deepEqual(emptyBodySchema.parse(null), {});
  assert.deepEqual(emptyBodySchema.parse({}), {});
});

test('emptyBodySchema rejects unexpected fields on action routes', () => {
  const result = emptyBodySchema.safeParse({ confirm: true });
  assert.equal(result.success, false);
});
