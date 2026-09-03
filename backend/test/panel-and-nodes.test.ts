import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('resolveComposeDir uses AEGIS_COMPOSE_DIR when the compose file is there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-compose-'));
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  const previous = process.env.AEGIS_COMPOSE_DIR;
  process.env.AEGIS_COMPOSE_DIR = dir;
  try {
    assert.equal(PanelService.resolveComposeDir(), path.resolve(dir));
  } finally {
    if (previous === undefined) delete process.env.AEGIS_COMPOSE_DIR;
    else process.env.AEGIS_COMPOSE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveComposeDir throws when AEGIS_COMPOSE_DIR has no compose file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-compose-empty-'));
  const previous = process.env.AEGIS_COMPOSE_DIR;
  process.env.AEGIS_COMPOSE_DIR = dir;
  try {
    assert.throws(() => PanelService.resolveComposeDir(), /AEGIS_COMPOSE_DIR/);
  } finally {
    if (previous === undefined) delete process.env.AEGIS_COMPOSE_DIR;
    else process.env.AEGIS_COMPOSE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('redactPanelSecrets strips JWT_SECRET from compose output', () => {
  const secret = process.env.JWT_SECRET as string;
  assert.match(PanelService.redactPanelSecrets(`token=${secret} ok`), /token=\*\*\* ok/);
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
