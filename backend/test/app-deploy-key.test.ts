import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintPublicKey, generateDeployKey } from '../src/utils/app-deploy-key.js';

test('generates an OpenSSH public key and a stable fingerprint', () => {
  const key = generateDeployKey('aegis-test');
  assert.match(key.publicKey, /^ssh-ed25519 /);
  assert.match(key.privateKey, /BEGIN PRIVATE KEY/);
  assert.match(key.fingerprint, /^SHA256:/);
  assert.equal(fingerprintPublicKey(key.publicKey), key.fingerprint);
});
