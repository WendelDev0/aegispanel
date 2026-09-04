import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gitUpdateCommands,
  hasComposeGit,
  sanitizeUpdateRef,
  updateComposeCheckout,
} from '../src/utils/panel-update.js';
import { PanelService } from '../src/services/panel.service.js';
import { CONFIG } from '../src/config.js';

test('sanitizeUpdateRef accepts a normal branch and rejects injection', () => {
  assert.equal(sanitizeUpdateRef('cursor/prd-infra-pro-adf8'), 'cursor/prd-infra-pro-adf8');
  assert.equal(sanitizeUpdateRef(undefined), 'main');
  assert.throws(() => sanitizeUpdateRef('main; rm -rf /'), /inválido/);
  assert.throws(() => sanitizeUpdateRef('../etc/passwd'), /inválido/);
  assert.throws(() => sanitizeUpdateRef('foo bar'), /inválido/);
});

test('gitUpdateCommands never go through a shell and pin safe.directory', () => {
  const cmds = gitUpdateCommands('/opt/aegispanel', 'main');
  assert.equal(cmds.length, 2);
  assert.ok(cmds[0].includes('safe.directory=/opt/aegispanel'));
  assert.ok(cmds[0].includes('fetch'));
  assert.ok(cmds[1].includes('checkout'));
  for (const args of cmds) {
    assert.equal(args.some((a) => a.includes('..')), false);
    assert.equal(args.some((a) => a.includes(';')), false);
  }
});

test('updateComposeCheckout skips pull when there is no .git', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-compose-nogit-'));
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  try {
    assert.equal(hasComposeGit(dir), false);
    const result = await updateComposeCheckout(dir, {
      ref: 'main',
      runGit: async () => {
        throw new Error('git should not run');
      },
    });
    assert.equal(result.pulled, false);
    assert.equal(result.skippedReason, 'no-git');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PanelService.selfUpdate is still blocked in LOCAL_MODE', async () => {
  assert.equal(CONFIG.LOCAL_MODE, true);
  await assert.rejects(() => PanelService.selfUpdate(), /LOCAL_MODE/);
});
