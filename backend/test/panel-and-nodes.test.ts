import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelService } from '../src/services/panel.service.js';
import { NodeService, LOCAL_NODE_ID } from '../src/services/node.service.js';
import { CONFIG } from '../src/config.js';

test('PanelService refuses unknown log targets', async () => {
  await assert.rejects(
    () => PanelService.getStackLogs('not-a-real-container'),
    /Alvo de log inválido/
  );
});

test('PanelService.selfUpdate is blocked in LOCAL_MODE', async () => {
  assert.equal(CONFIG.LOCAL_MODE, true);
  await assert.rejects(() => PanelService.selfUpdate(), /LOCAL_MODE/);
});

test('assertDeployTarget allows local node', async () => {
  const result = await NodeService.assertDeployTarget({
    name: 'demo',
    sourceType: 'git',
  });
  assert.equal(result.nodeId, LOCAL_NODE_ID);
  assert.equal(result.isRemote, false);
});

test('assertDeployTarget refuses missing remote node', async () => {
  await assert.rejects(
    () =>
      NodeService.assertDeployTarget({
        name: 'demo',
        sourceType: 'image',
        nodeId: 'node-does-not-exist',
      }),
    /não existe/
  );
});

test('assertDeployTarget refuses git source on remote node that exists as local id only via fake', async () => {
  // Use local node id with a pretend remote by checking the git refusal path
  // through a node that is registered — create via storage if needed.
  const { dbStorage } = await import('../src/db/storage.js');
  const node = {
    id: 'node-remote-test',
    name: 'Remote Test',
    type: 'vps' as const,
    hostIp: '10.0.0.2',
    isCurrent: false,
    status: 'online' as const,
    sshHost: '10.0.0.2',
    sshUser: 'root',
    sshPrivateKey: 'aegis.v1:deadbeef',
    sshHostFingerprint: 'SHA256:test',
  };
  // Don't encrypt — assertDeployTarget for git fails before health/key use.
  dbStorage.saveServerNode(node as any);

  await assert.rejects(
    () =>
      NodeService.assertDeployTarget({
        name: 'demo',
        sourceType: 'git',
        nodeId: 'node-remote-test',
      }),
    /ainda não suport/
  );
});
