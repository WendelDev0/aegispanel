import { LOCAL_NODE_ID } from '../services/node.service.js';
import { containerNameForApp } from './naming.js';
import type { AppRecord, ServerNode } from '../db/storage.js';

/**
 * Resolves the Caddy reverse_proxy upstream for an application.
 *
 * Local apps stay on the shared Docker network (container DNS). Remote apps
 * are reached via the node's published host port — Caddy on the panel host
 * cannot resolve container names on another machine.
 */
export function resolveAppUpstream(
  app: Pick<AppRecord, 'name' | 'nodeId' | 'port' | 'internalPort'>,
  node?: ServerNode | null
): string {
  const isRemote =
    Boolean(app.nodeId) &&
    app.nodeId !== LOCAL_NODE_ID &&
    !(node?.isLocal);

  if (isRemote) {
    const host = (node?.hostIp || node?.sshHost || '').trim();
    if (!host) {
      return `host.docker.internal:${app.port}`;
    }
    // Caddy's reverse_proxy needs brackets around a raw IPv6 address.
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `${authority}:${app.port}`;
  }

  return `${containerNameForApp(app.name)}:${app.internalPort || 3000}`;
}

export function isRemoteTarget(nodeId: string | undefined, node?: ServerNode | null): boolean {
  if (!nodeId || nodeId === LOCAL_NODE_ID) return false;
  if (node) return !node.isLocal;
  return true;
}
