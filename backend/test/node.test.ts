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

test('the SSH username rejects a server name pasted into the field', () => {
  // The real mistake seen in use: "VPS SELVA" (the server's display name) was
  // accepted by the form, then failed on the node as a generic auth refusal.
  const valid = (u: string) => /^[a-z_][a-z0-9_-]{0,31}$/i.test(u) && !/\s/.test(u);

  assert.equal(valid('VPS SELVA'), false);
  assert.equal(valid('meu servidor'), false);
  assert.equal(valid('root@host'), false);
  assert.equal(valid(''), false);

  assert.equal(valid('aegis'), true);
  assert.equal(valid('root'), true);
  assert.equal(valid('ubuntu'), true);
  assert.equal(valid('deploy_user-01'), true);
});

test('databases bind to loopback by default', async () => {
  const { CONFIG } = await import('../src/config.js');
  // Docker's iptables rules are evaluated before ufw, so a database published
  // on 0.0.0.0 sits on the public internet whatever the firewall says.
  assert.equal(CONFIG.DB_BIND_IP, '127.0.0.1');
});
