import { dbStorage, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { AlertService } from './alert.service.js';
import { AppService } from './app.service.js';
import { NodeService } from './node.service.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { AuditStore } from '../utils/audit.store.js';

/**
 * Watches managed app containers for kernel-level kills.
 *
 * Needed because a memory ceiling is invisible from inside the panel without
 * it: the kernel kills the process, Docker's `unless-stopped` policy restarts
 * the container, and the app is "running" again within a second. The operator
 * sees an app that works but loses requests, with nothing in the panel saying
 * why. The limit is only useful if crossing it is reported.
 *
 * Separate from the 2s metrics loop on purpose. That loop skips entirely when
 * nobody has the dashboard open, which is exactly when an unattended app is
 * dying, and inspecting every container at 2s would put real load on the daemon.
 */

/** Last restart count seen per container, so one kill is reported once. */
const lastSeenRestarts = new Map<string, number>();

export interface OomEvent {
  appId: string;
  appName: string;
  restartCount: number;
  memoryLimitMb: number;
}

export class WatchdogService {
  private static timer: NodeJS.Timeout | null = null;

  /**
   * Decides whether an observation is a new kill.
   *
   * Pure so the dedup rule is testable: `oomKilled` remains true on the exit
   * record of an already-restarted container, so reporting on that flag alone
   * would alert once per interval forever.
   */
  static isNewOomKill(containerId: string, oomKilled: boolean, restartCount: number): boolean {
    const previous = lastSeenRestarts.get(containerId);
    lastSeenRestarts.set(containerId, restartCount);

    if (!oomKilled) return false;
    // First sighting: report only if the container has actually restarted, so
    // a panel restart does not replay every historical kill as news.
    if (previous === undefined) return restartCount > 0;
    return restartCount > previous;
  }

  /** Drops bookkeeping for containers the panel no longer manages. */
  static forget(containerId: string): void {
    lastSeenRestarts.delete(containerId);
  }

  private static async clientFor(app: AppRecord) {
    if (!app.nodeId) return undefined;
    const node = NodeService.getById(app.nodeId);
    if (!isRemoteTarget(app.nodeId, node || null)) return undefined;
    return NodeService.getClient(app.nodeId).catch(() => undefined);
  }

  /**
   * One sweep over every app with a container. Returns what it reported, so a
   * test can assert on the decision instead of on the alert side effects.
   */
  static async checkOomKills(): Promise<OomEvent[]> {
    const events: OomEvent[] = [];
    const apps = dbStorage.getApps().filter((app) => app.containerId);
    const live = new Set<string>();

    for (const app of apps) {
      const containerId = app.containerId!;
      live.add(containerId);

      const client = await this.clientFor(app);
      const runtime = await dockerService.inspectRuntime(containerId, client);
      if (!runtime) continue;

      if (!this.isNewOomKill(containerId, runtime.oomKilled, runtime.restartCount)) continue;

      const limits = AppService.resolveLimits(app);
      const event: OomEvent = {
        appId: app.id,
        appName: app.name,
        restartCount: runtime.restartCount,
        memoryLimitMb: runtime.memoryLimitBytes
          ? Math.round(runtime.memoryLimitBytes / 1024 / 1024)
          : limits.memoryMb,
      };
      events.push(event);

      const suggestion = Math.max(event.memoryLimitMb * 2, event.memoryLimitMb + 256);
      const detail =
        `A aplicação "${app.name}" foi encerrada pelo kernel por exceder o limite de memória ` +
        `(${event.memoryLimitMb} MB). O contêiner reiniciou sozinho, mas as requisições em curso foram perdidas. ` +
        `Se isso se repetir, aumente o limite em Aplicações → Editar → Recursos (sugestão: ${suggestion} MB) ` +
        `ou investigue o consumo em Observabilidade.`;

      AuditStore.append({
        action: 'app.oom_killed',
        outcome: 'failure',
        target: { type: 'app', id: app.id, name: app.name },
        meta: { memoryLimitMb: event.memoryLimitMb, restartCount: event.restartCount },
      });

      dbStorage.addActivity({
        type: 'deploy',
        title: `OOM: "${app.name}" excedeu a memória`,
        description: detail,
        status: 'error',
        metadata: { appId: app.id, memoryLimitMb: event.memoryLimitMb },
      });

      await AlertService.broadcastNotification(
        `🧨 OOM: "${app.name}" morreu por memória`,
        detail,
        'alert',
        true,
        { appId: app.id }
      ).catch(() => {
        // A failed notification must not stop the sweep for the other apps.
      });
    }

    // Containers that disappeared (app deleted, redeployed under a new id)
    // must not keep a restart count that a recycled id would inherit.
    for (const id of [...lastSeenRestarts.keys()]) {
      if (!live.has(id)) lastSeenRestarts.delete(id);
    }

    return events;
  }

  static start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkOomKills().catch((err: any) => {
        console.warn('Watchdog OOM falhou:', err?.message);
      });
    }, intervalMs);
    this.timer.unref();
  }

  static stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
