import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCreatePreview,
  decidePreviewAction,
  defaultPreviewConfig,
  previewDomain,
} from '../src/utils/app-preview.js';
import type { AppPreviewRecord } from '../src/utils/app-build.js';

const config = { ...defaultPreviewConfig(), enabled: true, maxConcurrent: 2 };

function preview(pr: number): AppPreviewRecord {
  return {
    id: `p-${pr}`,
    appId: 'app-1',
    prNumber: pr,
    branch: 'feat',
    headSha: 'abc',
    containerIds: [],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    status: 'running',
  };
}

test('opened creates when under quota', () => {
  const decision = decidePreviewAction({ action: 'opened', number: 3 }, undefined, config, []);
  assert.equal(decision.action, 'create');
});

test('opened is ignored when the quota is full', () => {
  const decision = decidePreviewAction(
    { action: 'opened', number: 3 },
    undefined,
    config,
    [preview(1), preview(2)]
  );
  assert.equal(decision.action, 'ignore');
  assert.match(decision.reason, /Cota/);
});

test('synchronize updates an existing preview', () => {
  const decision = decidePreviewAction({ action: 'synchronize', number: 1 }, preview(1), config, [preview(1)]);
  assert.equal(decision.action, 'update');
});

test('closed removes the preview', () => {
  const decision = decidePreviewAction({ action: 'closed', number: 1 }, preview(1), config, [preview(1)]);
  assert.equal(decision.action, 'remove');
});

test('preview domain substitutes the PR number', () => {
  assert.equal(previewDomain(12, 'pr-{n}.{base}', { base: 'preview.localhost' }), 'pr-12.preview.localhost');
});

test('canCreatePreview counts building and running', () => {
  assert.equal(canCreatePreview([preview(1)], 1), false);
});
