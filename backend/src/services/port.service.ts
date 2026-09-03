import type Docker from 'dockerode';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { LOCAL_NODE_ID } from './node.service.js';

/**
 * Host ports that must never be handed out automatically.
 * 22/80/443 belong to the system and the reverse proxy; 3000/4000 are the
 * panel itself.
 */
const RESERVED_PORTS = new Set([22, 80, 443, 3000, 4000]);

const RANGE_START = 4100;
const RANGE_END = 9999;

export interface PortLookupOptions {
  /** Docker daemon to query for published ports (remote node). Defaults to local. */
  client?: Docker;
  /** Only treat panel apps on this node as occupying ports. */
  nodeId?: string;
}

export class PortService {
  /**
   * Host ports already spoken for.
   *
   * Collected from the Docker daemon and from the panel's own records rather
   * than by trying to bind a socket: this process runs inside a container with
   * its own network namespace, so a successful bind here would say nothing
   * about whether the port is free on the host.
   *
   * `excludeContainerId` lets a redeploy ignore the app's own running
   * container, which legitimately holds the port it is about to reuse.
   */
  static async getUsedPorts(
    excludeContainerId?: string,
    opts?: PortLookupOptions
  ): Promise<Set<number>> {
    const used = new Set<number>(RESERVED_PORTS);
    const nodeId = opts?.nodeId || LOCAL_NODE_ID;
    const isRemote = Boolean(opts?.client) || (nodeId !== LOCAL_NODE_ID);

    try {
      if (opts?.client) {
        const containers = await opts.client.listContainers({ all: false });
        for (const container of containers) {
          if (excludeContainerId && container.Id.startsWith(excludeContainerId.substring(0, 12))) {
            continue;
          }
          for (const port of container.Ports || []) {
            if (port.PublicPort) used.add(port.PublicPort);
          }
        }
      } else {
        const containers = await dockerService.listContainers(false);
        for (const container of containers) {
          if (excludeContainerId && container.id.startsWith(excludeContainerId.substring(0, 12))) {
            continue;
          }
          for (const port of container.ports) {
            if (port.publicPort) used.add(port.publicPort);
          }
        }
      }
    } catch {
      // Docker unreachable: fall back to the panel's own bookkeeping below.
    }

    // Records count as taken even when their container is stopped, so
    // restarting a stopped app does not find its port reassigned.
    for (const app of dbStorage.getApps()) {
      const appNode = app.nodeId || LOCAL_NODE_ID;
      if (appNode !== nodeId) continue;
      used.add(app.port);
    }

    // Databases always live on the panel host.
    if (!isRemote) {
      for (const db of dbStorage.getDatabases()) {
        used.add(db.port);
        if (db.guiPort) used.add(db.guiPort);
      }
    }

    return used;
  }

  /**
   * Returns a free host port.
   *
   * `preferred` is honoured when it is available, so an explicitly chosen port
   * is never silently moved; otherwise the first free port in the range is
   * returned. Callers that pass nothing get a port without the user having to
   * think about it at all.
   */
  static async allocate(
    preferred?: number,
    excludeContainerId?: string,
    opts?: PortLookupOptions
  ): Promise<number> {
    if (preferred !== undefined && (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535)) {
      throw new Error('A porta deve ser um número inteiro entre 1024 e 65535.');
    }
    const used = await this.getUsedPorts(excludeContainerId, opts);

    if (preferred && !used.has(preferred)) {
      return preferred;
    }

    for (let port = RANGE_START; port <= RANGE_END; port++) {
      if (!used.has(port)) return port;
    }

    throw new Error(
      `Nenhuma porta livre encontrada no intervalo ${RANGE_START}-${RANGE_END}. Remova aplicações ou bancos que não usa mais.`
    );
  }

  /** Whether a specific host port can be used right now. */
  static async isAvailable(
    port: number,
    excludeContainerId?: string,
    opts?: PortLookupOptions
  ): Promise<boolean> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
    const used = await this.getUsedPorts(excludeContainerId, opts);
    return !used.has(port);
  }

  /** Explains why a port cannot be used, for a validation message. */
  static async describeConflict(
    port: number,
    excludeContainerId?: string,
    opts?: PortLookupOptions
  ): Promise<string | null> {
    if (RESERVED_PORTS.has(port)) {
      return `A porta ${port} é reservada pelo sistema ou pelo próprio painel.`;
    }

    const nodeId = opts?.nodeId || LOCAL_NODE_ID;
    const app = dbStorage.getApps().find((a) => a.port === port && (a.nodeId || LOCAL_NODE_ID) === nodeId);
    if (app) return `A porta ${port} já está atribuída à aplicação "${app.name}".`;

    if (!opts?.client && nodeId === LOCAL_NODE_ID) {
      const db = dbStorage.getDatabases().find((d) => d.port === port || d.guiPort === port);
      if (db) return `A porta ${port} já está atribuída ao banco de dados "${db.name}".`;
    }

    if (!(await this.isAvailable(port, excludeContainerId, opts))) {
      return `A porta ${port} já está em uso por outro contêiner nesta máquina.`;
    }

    return null;
  }
}
