import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { CicdService } from '../src/services/cicd.service.js';

const SECRET = 'segredo-de-webhook-para-teste';
const BODY = JSON.stringify({ ref: 'refs/heads/main', head_commit: { id: 'abc123' } });

function sign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('accepts a correctly signed payload', () => {
  assert.equal(CicdService.verifyGitHubSignature(BODY, sign(BODY, SECRET), SECRET), true);
});

test('rejects a signature made with the wrong secret', () => {
  assert.equal(CicdService.verifyGitHubSignature(BODY, sign(BODY, 'outro-segredo'), SECRET), false);
});

test('rejects a payload modified after signing', () => {
  const signature = sign(BODY, SECRET);
  assert.equal(CicdService.verifyGitHubSignature(BODY + ' ', signature, SECRET), false);
});

test('rejects when the signature is missing', () => {
  // The previous implementation returned true here, so an unsigned request
  // passed verification.
  assert.equal(CicdService.verifyGitHubSignature(BODY, undefined, SECRET), false);
});

test('rejects when no secret is configured', () => {
  assert.equal(CicdService.verifyGitHubSignature(BODY, sign(BODY, SECRET), undefined), false);
});

test('rejects a malformed signature without throwing', () => {
  assert.equal(CicdService.verifyGitHubSignature(BODY, 'sha256=nope', SECRET), false);
  assert.equal(CicdService.verifyGitHubSignature(BODY, '', SECRET), false);
});

test('redacts credentials from build output', () => {
  const raw =
    'Cloning https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/app.git\n' +
    'token=github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz\n';
  const safe = CicdService.redactSecrets(raw);

  assert.ok(!safe.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(!safe.includes('github_pat_11ABCDEFG0123456789'));
  assert.ok(safe.includes('github.com/acme/app.git'), 'a URL do repositório deve continuar legível');
});
