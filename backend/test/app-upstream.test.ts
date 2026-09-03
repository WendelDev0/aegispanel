import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './setup.js';
import { resolveAppUpstream, isRemoteTarget } from '../src/utils/app-upstream.js';
import type { ServerNode } from '../src/db/storage.js';

describe('resolveAppUpstream', () => {
  it('uses container DNS for local apps', () => {
    assert.equal(
      resolveAppUpstream({ name: 'api', port: 4123, internalPort: 3000 }),
      'aegis-app-api:3000'
    );
  });

  it('uses container DNS when nodeId is node-local', () => {
    assert.equal(
      resolveAppUpstream({ name: 'web', nodeId: 'node-local', port: 4100, internalPort: 8080 }),
      'aegis-app-web:8080'
    );
  });

  it('uses hostIp:port for remote apps', () => {
    const node = {
      id: 'node-1',
      name: 'worker',
      hostIp: '10.0.0.9',
      sshHost: 'worker.internal',
      isLocal: false,
    } as ServerNode;

    assert.equal(
      resolveAppUpstream({ name: 'api', nodeId: 'node-1', port: 4123, internalPort: 3000 }, node),
      '10.0.0.9:4123'
    );
  });

  it('brackets an IPv6 hostIp for Caddy', () => {
    const node = {
      id: 'node-1',
      name: 'worker',
      hostIp: '2001:db8::9',
      isLocal: false,
    } as ServerNode;

    assert.equal(
      resolveAppUpstream({ name: 'api', nodeId: 'node-1', port: 4123, internalPort: 3000 }, node),
      '[2001:db8::9]:4123'
    );
  });

  it('falls back to sshHost when hostIp is missing', () => {
    const node = {
      id: 'node-1',
      name: 'worker',
      sshHost: 'worker.example.com',
      isLocal: false,
    } as ServerNode;

    assert.equal(
      resolveAppUpstream({ name: 'api', nodeId: 'node-1', port: 5000, internalPort: 3000 }, node),
      'worker.example.com:5000'
    );
  });

  it('falls back to host.docker.internal when node has no address', () => {
    const node = {
      id: 'node-1',
      name: 'worker',
      isLocal: false,
    } as ServerNode;

    assert.equal(
      resolveAppUpstream({ name: 'api', nodeId: 'node-1', port: 4123, internalPort: 3000 }, node),
      'host.docker.internal:4123'
    );
  });
});

describe('isRemoteTarget', () => {
  it('treats missing and local ids as local', () => {
    assert.equal(isRemoteTarget(undefined), false);
    assert.equal(isRemoteTarget('node-local'), false);
  });

  it('treats other node ids as remote unless marked local', () => {
    assert.equal(isRemoteTarget('node-1'), true);
    assert.equal(isRemoteTarget('node-1', { isLocal: true } as ServerNode), false);
    assert.equal(isRemoteTarget('node-1', { isLocal: false } as ServerNode), true);
  });
});
