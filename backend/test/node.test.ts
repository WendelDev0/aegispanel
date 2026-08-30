import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeService } from '../src/services/node.service.js';
import { EncryptionService } from '../src/utils/crypto.js';
import type { ServerNode } from '../src/db/storage.js';

function nodeWithKey(): ServerNode {
  return {
    id: 'node-test',
    name: 'Teste',
    type: 'vps',
    hostIp: '10.0.0.9',
    isCurrent: false,
    status: 'unknown',
    sshHost: '10.0.0.9',
    sshPort: 22,
    sshUser: 'aegis',
    sshPrivateKey: EncryptionService.encrypt('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'),
    sshPassphrase: EncryptionService.encrypt('segredo'),
  };
}

test('toPublic never exposes the SSH key or passphrase', () => {
  const publicNode = NodeService.toPublic(nodeWithKey()) as Record<string, unknown>;

  // The key grants root on the remote node; it must not reach the browser.
  assert.equal(publicNode.sshPrivateKey, undefined);
  assert.equal(publicNode.sshPassphrase, undefined);
  assert.equal(JSON.stringify(publicNode).includes('BEGIN OPENSSH'), false);
  assert.equal(JSON.stringify(publicNode).includes('segredo'), false);

  // But the UI still has to know whether one is configured.
  assert.equal(publicNode.hasSshKey, true);
  assert.equal(publicNode.hasPassphrase, true);

  // Non-secret fields survive.
  assert.equal(publicNode.sshUser, 'aegis');
  assert.equal(publicNode.sshHost, '10.0.0.9');
});

test('toPublic reports a node without credentials as such', () => {
  const bare = NodeService.toPublic({
    id: 'node-local',
    name: 'Este Servidor',
    type: 'local',
    hostIp: '127.0.0.1',
    isLocal: true,
    isCurrent: true,
    status: 'online',
  }) as Record<string, unknown>;

  assert.equal(bare.hasSshKey, false);
  assert.equal(bare.hasPassphrase, false);
});

test('the SSH key round-trips through encryption at rest', () => {
  const node = nodeWithKey();
  const decrypted = EncryptionService.decrypt(node.sshPrivateKey!);
  assert.ok(decrypted.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'));
  assert.notEqual(node.sshPrivateKey, decrypted);
});

test('an unknown node id is rejected rather than silently using the local daemon', async () => {
  await assert.rejects(() => NodeService.getClient('node-inexistente'), /não encontrado/i);
});
