import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dockerService } from '../src/services/docker.service.js';
import { collectBuildContextFiles } from '../src/utils/build-context.js';
import { remoteWorkloadPlacement } from '../src/utils/app-upstream.js';
import { NodeService } from '../src/services/node.service.js';
import { dbStorage } from '../src/db/storage.js';

test('remote placement publishes on all interfaces and skips aegis-net', () => {
  const remote = remoteWorkloadPlacement(true);
  assert.equal(remote.useRemoteDocker, true);
  assert.equal(remote.publishOnAllInterfaces, true);
  assert.equal(remote.joinPanelNetwork, false);

  const local = remoteWorkloadPlacement(false);
  assert.equal(local.useRemoteDocker, false);
  assert.equal(local.joinPanelNetwork, true);
});

test('collectBuildContextFiles keeps Dockerfile and skips .git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ctx-'));
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM scratch\n');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(dir, 'index.js'), 'console.log(1)\n');
  try {
    const files = collectBuildContextFiles(dir);
    assert.ok(files.includes('Dockerfile'));
    assert.ok(files.includes('index.js'));
    assert.equal(files.some((f) => f.startsWith('.git')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildImage uses the provided docker client, not the panel singleton', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-build-'));
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM scratch\n');
  const seen: string[] = [];
  const fake = {
    buildImage: async () => Readable.from([]),
    modem: {
      followProgress: (
        _stream: unknown,
        done: (err: Error | null) => void,
        progress: (ev: { stream?: string }) => void
      ) => {
        progress({ stream: 'Step 1/1 : FROM scratch\n' });
        done(null);
      },
    },
  };

  try {
    await dockerService.buildImage({
      contextDir: dir,
      tags: ['aegis-app-demo:latest'],
      client: fake as any,
      onOutput: (chunk) => seen.push(chunk),
    });
    assert.match(seen.join(''), /FROM scratch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertDeployTarget no longer refuses git at the source-type gate', async () => {
  const node = {
    id: 'node-remote-git',
    name: 'Remote Git',
    type: 'vps' as const,
    hostIp: '10.0.0.2',
    isCurrent: false,
    status: 'online' as const,
    sshHost: '10.0.0.2',
    sshUser: 'root',
    sshPrivateKey: 'aegis.v1:deadbeef',
    sshHostFingerprint: 'SHA256:test',
  };
  dbStorage.saveServerNode(node as any);

  try {
    await NodeService.assertDeployTarget({
      name: 'demo',
      sourceType: 'git',
      nodeId: 'node-remote-git',
    });
  } catch (err: any) {
    assert.equal(/ainda não suport/i.test(String(err.message)), false);
  }
});
