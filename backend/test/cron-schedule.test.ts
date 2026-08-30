import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CronService } from '../src/services/cron.service.js';

test('accepts common cron expressions', () => {
  for (const expr of ['0 3 * * *', '*/5 * * * *', '0 0 * * 0', '30 2 1 1 *', '0 9-17 * * 1-5']) {
    assert.equal(CronService.isValidSchedule(expr), true, expr);
  }
});

test('rejects malformed expressions', () => {
  for (const expr of ['', '0 3 * *', '0 3 * * * *', '60 3 * * *', '0 24 * * *', 'abc', '0 3 * * 8', '*/0 * * * *']) {
    assert.equal(CronService.isValidSchedule(expr), false, expr);
  }
});
