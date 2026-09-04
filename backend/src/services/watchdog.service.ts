import { dbStorage, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { AlertService } from './alert.service.js';
import { AppService } from './app.service.js';
import { NodeService } from './node.service.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { AuditStore } from '../utils/audit.store.js';
import { CaddyService } from './caddy.service.js';
import { HealthService } from './health.service.js';
import {
  decideRestart,
  MAX_RESTARTS_PER_HOUR,
  UNHEALTHY_CYCLES_BEFORE_RESTART,
  type HealthStatus,
} from '../utils/health-probe.js';

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

  /**
   * Restart timestamps per app, for the per-hour cap.
   *
   * In memory on purpose: after a panel restart the operator is present and
   * the cap should not still be blocking a recovery from an hour ago.
   */
  private static restartHistory = new Map<string, number[]>();

  private static restartsInLastHour(appId: string, now: number): number {
    const cutoff = now - 60 * 60 * 1000;
    const recent = (this.restartHistory.get(appId) || []).filter((at) => at > cutoff);
    this.restartHistory.set(appId, recent);
    return recent.length;
  }

  /**
   * Probes every running app and restarts the ones that stopped answering.
   *
   * Probing from the panel rather than reading Docker's healthcheck: that probe
   * runs inside the container and needs wget or curl to exist there, which a
   * distroless image does not have. Docker's own status is used when the app
   * opted into an in-container healthcheck, since that is the more precise
   * signal when it is available.
   */
  static async checkAppHealth(): Promise<Array<{ appId: string; status: HealthStatus; restarted: boolean }>> {
    const results: Array<{ appId: string; status: HealthStatus; restarted: boolean }> = [];
    const now = Date.now();

    for (const app of dbStorage.getApps()) {
      // Only apps that are supposed to be up. A stopped app is not unhealthy,
      // it is stopped, and restarting it would fight the operator.
      if (!app.containerId || app.status !== 'running') continue;

      const probe = await HealthService.probeApp(app);
      const previous = app.health?.consecutiveFailures ?? 0;
      const consecutiveFailures = probe.reachable ? 0 : previous + 1;
      const status: HealthStatus = probe.reachable
        ? 'healthy'
        : consecutiveFailures >= UNHEALTHY_CYCLES_BEFORE_RESTART
          ? 'unhealthy'
          : 'starting';

      const wasUnhealthy = app.health?.status === 'unhealthy';
      app.health = {
        status,
        checkedAt: new Date().toISOString(),
        consecutiveFailures,
        lastError: probe.reachable ? undefined : probe.error,
      };
      dbStorage.saveApp(app);

      // Answering again clears the "cannot be restarted" mark: whatever was
      // wrong with the container reference was fixed, usually by a redeploy.
      if (status === 'healthy') this.unrestartable.delete(app.id);

      // An app that just came back has to be put back into Caddy, which only
      // routes to upstreams that are not known-unhealthy.
      if (wasUnhealthy && status === 'healthy') {
        await CaddyService.syncCaddyfile().catch(() => {});
        await AlertService.broadcastNotification(
          `✅ "${app.name}" voltou a responder`,
          `A aplicação "${app.name}" respondeu novamente e voltou a receber tráfego.`,
          'alert',
          false,
          { appId: app.id }
        ).catch(() => {});
      }

      const decision = decideRestart({
        consecutiveFailures,
        restartsInLastHour: this.restartsInLastHour(app.id, now),
      });

      let restarted = false;
      if (decision.restart) {
        restarted = await this.restartApp(app, decision.reason);
      } else if (decision.giveUp && !wasUnhealthy) {
        await this.escalate(app, decision.reason);
      }

      // The first cycle an app is declared unhealthy, pull it out of Caddy so
      // visitors get the panel's maintenance page instead of a raw 502.
      if (status === 'unhealthy' && !wasUnhealthy) {
        await CaddyService.syncCaddyfile().catch(() => {});
      }

      results.push({ appId: app.id, status, restarted });
    }

    return results;
  }

  /**
   * Apps whose container the panel cannot restart at all.
   *
   * Kept so a permanent failure is reported once instead of every cycle. The
   * entry is dropped as soon as the app answers again, so a container that is
   * later redeployed correctly is eligible once more.
   */
  private static unrestartable = new Set<string>();

  /**
   * A failure that will repeat identically on the next attempt.
   *
   * The record's containerId can point at a container that was replaced or
   * removed — inspect then fails and the container reads as unmanaged. Retrying
   * that every 30s burns the hourly budget on an action that cannot succeed and
   * fills the log with the same stack trace, which is what it did in production.
   */
  private static isPermanentRestartFailure(message: string): boolean {
    const text = (message || '').toLowerCase();
    return (
      text.includes('não gerenciado') ||
      text.includes('no such container') ||
      text.includes('not found') ||
      text.includes('404')
    );
  }

  private static async restartApp(app: AppRecord, reason: string): Promise<boolean> {
    if (this.unrestartable.has(app.id)) return false;

    let outcome: 'success' | 'failure' = 'failure';
    let error: string | undefined;

    try {
      const client = await this.clientFor(app);
      await dockerService.restartContainer(app.containerId!, client);
      outcome = 'success';
      console.warn(`🔁 Watchdog reiniciou "${app.name}": ${reason}`);
    } catch (err: any) {
      error = err?.message || String(err);
    }

    // Recorded after the attempt, with what actually happened. Writing
    // `success` up front logged restarts that never occurred, which is worse
    // than no audit trail: it says the panel acted when it did not.
    AuditStore.append({
      action: 'app.watchdog.restart',
      outcome,
      target: { type: 'app', id: app.id, name: app.name },
      meta: error ? { reason, error } : { reason },
    });

    if (outcome === 'success') {
      // Only a real restart counts against the hourly cap. Charging failed
      // attempts to it would exhaust the budget without the app ever having
      // been restarted once.
      const history = this.restartHistory.get(app.id) || [];
      history.push(Date.now());
      this.restartHistory.set(app.id, history);
      return true;
    }

    if (this.isPermanentRestartFailure(error || '')) {
      this.unrestartable.add(app.id);
      await this.reportUnrestartable(app, error || 'motivo desconhecido');
    } else {
      console.warn(`Watchdog não conseguiu reiniciar "${app.name}": ${error}`);
    }
    return false;
  }

  /**
   * Says the panel cannot act, instead of retrying something impossible.
   *
   * The usual cause is a stale containerId on the app record: the container it
   * names was replaced or removed, so the panel is holding a reference to
   * something that no longer exists. A redeploy fixes it, and only a human can
   * decide to do that.
   */
  private static async reportUnrestartable(app: AppRecord, error: string): Promise<void> {
    const detail =
      `A aplicação "${app.name}" não responde e o painel não consegue reiniciá-la: ${error}. ` +
      'Normalmente isso significa que o contêiner registrado não existe mais — refaça o deploy da aplicação. ' +
      'O watchdog parou de tentar até ela voltar a responder.';

    AuditStore.append({
      action: 'app.watchdog.unrestartable',
      outcome: 'failure',
      target: { type: 'app', id: app.id, name: app.name },
      meta: { error },
    });
    dbStorage.addActivity({
      type: 'deploy',
      title: `Watchdog não consegue reiniciar: ${app.name}`,
      description: detail,
      status: 'error',
      metadata: { appId: app.id },
    });
    await AlertService.broadcastNotification(
      `🚨 "${app.name}" não responde e não pode ser reiniciada`,
      detail,
      'alert',
      true,
      { appId: app.id }
    ).catch(() => {});
    console.warn(`⛔ ${detail}`);
  }

  /**
   * Stops restarting and tells a human.
   *
   * An app that crashes on boot is unhealthy again seconds after each restart,
   * so an uncapped watchdog turns one broken deploy into an endless loop that
   * burns CPU and floods the alert channel. Leaving the container alone is the
   * state an operator can actually diagnose.
   */
  private static async escalate(app: AppRecord, reason: string): Promise<void> {
    const detail =
      `A aplicação "${app.name}" continua sem responder após ${MAX_RESTARTS_PER_HOUR} reinícios nesta hora. ` +
      'O painel parou de reiniciá-la e removeu o domínio do proxy — os visitantes veem a página de manutenção. ' +
      'Veja os logs da aplicação para descobrir por que ela não sobe.';

    AuditStore.append({
      action: 'app.watchdog.give_up',
      outcome: 'failure',
      target: { type: 'app', id: app.id, name: app.name },
      meta: { reason },
    });
    dbStorage.addActivity({
      type: 'deploy',
      title: `Watchdog desistiu: ${app.name}`,
      description: detail,
      status: 'error',
      metadata: { appId: app.id },
    });
    await AlertService.broadcastNotification(
      `🚨 "${app.name}" não sobe`,
      detail,
      'alert',
      true,
      { appId: app.id }
    ).catch(() => {});
  }

  static start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkOomKills().catch((err: any) => {
        console.warn('Watchdog OOM falhou:', err?.message);
      });
      this.checkAppHealth().catch((err: any) => {
        console.warn('Watchdog de saúde falhou:', err?.message);
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
