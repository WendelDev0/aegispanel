import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { authorizeWebhook, parseWebhookEvent } from '../src/utils/git-webhook.js';

const SECRET = 'segredo-de-webhook-para-teste';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

test('rejects a payload without a signature', () => {
  const body = '{"ref":"refs/heads/main"}';
  const auth = authorizeWebhook({}, body, SECRET);
  assert.equal(auth.ok, false);
});

test('accepts GitHub HMAC', () => {
  const body = '{"ref":"refs/heads/main"}';
  const auth = authorizeWebhook({ 'x-hub-signature-256': sign(body) }, body, SECRET);
  assert.equal(auth.ok, true);
});

test('accepts GitLab token', () => {
  const auth = authorizeWebhook({ 'x-gitlab-token': SECRET }, '{}', SECRET);
  assert.equal(auth.ok, true);
  if (auth.ok) assert.equal(auth.provider, 'gitlab');
});

test('rejects a GitLab token that does not match', () => {
  const auth = authorizeWebhook({ 'x-gitlab-token': 'nope' }, '{}', SECRET);
  assert.equal(auth.ok, false);
});

test('parses a GitHub tag push', () => {
  const parsed = parseWebhookEvent({}, { ref: 'refs/tags/v1.2.0', after: 'abcdef1234567890' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.event.kind, 'tag');
  if (parsed.event.kind === 'tag') assert.equal(parsed.event.tag, 'v1.2.0');
});

test('parses a GitHub pull request', () => {
  const parsed = parseWebhookEvent(
    { 'x-github-event': 'pull_request' },
    {
      action: 'opened',
      pull_request: { number: 12, head: { ref: 'feat', sha: 'abc123def456' } },
    }
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.event.kind, 'pr');
  if (parsed.event.kind === 'pr') {
    assert.equal(parsed.event.number, 12);
    assert.equal(parsed.event.action, 'opened');
  }
});
