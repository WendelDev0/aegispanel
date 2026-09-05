import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkComposeUpdate,
  gitStatusCommands,
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

test('gitStatusCommands fetch and compare without checkout', () => {
  const cmds = gitStatusCommands('/opt/aegispanel', 'main');
  assert.equal(cmds.length, 5);
  assert.ok(cmds[0].includes('fetch'));
  assert.equal(cmds.some((args) => args.includes('checkout')), false);
  for (const args of cmds) {
    assert.equal(args.some((a) => a.includes(';')), false);
  }
});

test('checkComposeUpdate is available when origin is ahead', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-compose-git-'));
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  fs.mkdirSync(path.join(dir, '.git'));
  try {
    const status = await checkComposeUpdate(dir, {
      ref: 'main',
      runGit: async (args) => {
        if (args.includes('fetch')) return '';
        if (args.includes('rev-list')) return '2';
        if (args.includes('HEAD') && args.includes('rev-parse') && !args.includes('FETCH_HEAD')) return 'abc1234';
        if (args.includes('FETCH_HEAD') && args.includes('rev-parse')) return 'def5678';
        if (args.includes('log')) return 'feat(flows): native WhatsApp builder';
        return '';
      },
    });
    assert.equal(status.available, true);
    assert.equal(status.behind, 2);
    assert.match(status.remoteSubject, /WhatsApp/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PanelService.selfUpdate is still blocked in LOCAL_MODE', async () => {
  assert.equal(CONFIG.LOCAL_MODE, true);
  await assert.rejects(() => PanelService.selfUpdate(), /LOCAL_MODE/);
});
