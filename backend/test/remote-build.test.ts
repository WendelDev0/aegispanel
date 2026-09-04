import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gitBuildContext,
  planBuildContext,
  shouldFallBackToPanelClone,
} from '../src/utils/remote-build.js';

const base = {
  isRemote: true,
  sourceType: 'git' as const,
  gitUrl: 'https://github.com/acme/app.git',
  hasToken: false,
};

test('a local deploy always clones on the panel', () => {
  const plan = planBuildContext({ ...base, isRemote: false });
  assert.equal(plan.mode, 'panel-clone');
});

test('a public remote git app lets the node fetch it', () => {
  assert.equal(planBuildContext(base).mode, 'daemon-git');
});

/**
 * Docker fetches the remote context before the build starts, so there is no
 * secret mechanism for it — authenticating means putting the token in the URL,
 * which the node's daemon then logs. The panel already clones private repos
 * with the token in a git config header, never in argv and never on disk.
 */
test('a private repository stays on the panel', () => {
  const plan = planBuildContext({ ...base, hasToken: true });
  assert.equal(plan.mode, 'panel-clone');
  assert.match(plan.reason, /privado/i);
});

test('an image or dockerfile app is not a git context', () => {
  assert.equal(planBuildContext({ ...base, sourceType: 'image' }).mode, 'panel-clone');
  assert.equal(planBuildContext({ ...base, sourceType: 'dockerfile' }).mode, 'panel-clone');
});

test('the app can opt out explicitly', () => {
  const plan = planBuildContext({ ...base, remoteCloneDisabled: true });
  assert.equal(plan.mode, 'panel-clone');
});

test('a git app with no URL cannot use a remote context', () => {
  assert.equal(planBuildContext({ ...base, gitUrl: undefined }).mode, 'panel-clone');
});

test('the context pins a branch or a commit as the fragment', () => {
  assert.equal(
    gitBuildContext('https://github.com/acme/app.git', 'main'),
    'https://github.com/acme/app.git#main'
  );
  const sha = 'a'.repeat(40);
  assert.ok(gitBuildContext('https://github.com/acme/app.git', sha).endsWith(`#${sha}`));
});

/**
 * The URL travels to the remote daemon as a query parameter that daemon logs,
 * so a credential embedded in it would end up in that machine's logs.
 */
test('a URL carrying credentials is refused', () => {
  assert.throws(
    () => gitBuildContext('https://user:token@github.com/acme/app.git', 'main'),
    /credenciais/i
  );
});

test('a non-HTTPS remote is refused', () => {
  assert.throws(() => gitBuildContext('http://github.com/acme/app.git', 'main'), /HTTPS/i);
  assert.throws(() => gitBuildContext('git@github.com:acme/app.git', 'main'), /.+/);
});

test('a ref that could escape the fragment is refused', () => {
  for (const ref of ['../../etc', 'main;rm -rf /', 'main#other', 'a..b', '']) {
    assert.throws(
      () => gitBuildContext('https://github.com/acme/app.git', ref),
      /inválida/i,
      `deveria recusar ${JSON.stringify(ref)}`
    );
  }
});

/**
 * A Dockerfile error fails identically after a local clone, so retrying would
 * double the duration of every broken deploy and print the same error twice.
 */
test('a build failure is not retried on the panel', () => {
  assert.equal(shouldFallBackToPanelClone('The command returned a non-zero code: 1'), false);
  assert.equal(shouldFallBackToPanelClone('failed to solve: dockerfile parse error'), false);
  assert.equal(shouldFallBackToPanelClone('executor failed running [/bin/sh -c npm ci]'), false);
});

test('a context failure falls back to the panel clone', () => {
  assert.equal(shouldFallBackToPanelClone('unable to prepare context: repository not found'), true);
  assert.equal(shouldFallBackToPanelClone('error fetching git: unsupported protocol'), true);
});

test('an unrecognised message does not trigger a pointless retry', () => {
  assert.equal(shouldFallBackToPanelClone('no space left on device'), false);
  assert.equal(shouldFallBackToPanelClone(''), false);
});
