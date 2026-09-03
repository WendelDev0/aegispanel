import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { AlertService } from './alert.service.js';
import { NodeService } from './node.service.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { AuditStore } from '../utils/audit.store.js';
import { containerNameForApp } from '../utils/naming.js';
import { decideUnhealthyRestart, type RestartBudget } from '../utils/health-watchdog.js';

const TICK_MS = 8_000;
const OOM_DEBOUNCE_MS = 30 * 60 * 1000;

/**
 * Dedicated health loop. The 2s system-metrics timer skips when no Socket.IO
 * client is connected; a flap on an unhealthy app must not wait for someone
 * to open the dashboard.
 */
export class HealthWatchdog {
  private static timer: NodeJS.Timeout | null = null;
  private static inFlight = false;
  private static budgets = new Map<string, RestartBudget>();
  private static exhaustedAlerted = new Set<string>();
  private static lastOomAlert = new Map<string, number>();
  private static lastHealth = new Map<string, string>();

  static start(): void {
    if (CONFIG.LOCAL_MODE) {
      console.log('🧪 Modo local: watchdog de healthcheck desligado.');
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref();
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for tests. */
  static async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.scan();
    } catch (err: any) {
      console.warn('Watchdog de healthcheck:', err?.message || err);
    } finally {
      this.inFlight = false;
    }
  }

  private static async scan(): Promise<void> {
    let healthFlipped = false;

    for (const app of dbStorage.getApps()) {
      if (!app.containerId) continue;

      const client = await this.clientFor(app);
      const runtime = await dockerService.inspectRuntime(app.containerId, client);
      if (!runtime) continue;

      if (runtime.oomKilled) {
        await this.maybeAlertOom(app.id, app.name);
      }

      const previous = this.lastHealth.get(app.id);
      if (previous && previous !== runtime.health && (runtime.health === 'unhealthy' || previous === 'unhealthy')) {
        healthFlipped = true;
      }
      this.lastHealth.set(app.id, runtime.health);

      if (runtime.health !== 'unhealthy') {
        this.budgets.delete(app.id);
        this.exhaustedAlerted.delete(app.id);
        continue;
      }

      const decision = decideUnhealthyRestart(this.budgets.get(app.id) || { consecutiveUnhealthy: 0, restartTimes: [] });
      this.budgets.set(app.id, decision.next);

      if (decision.exhausted) {
        if (!this.exhaustedAlerted.has(app.id)) {
          this.exhaustedAlerted.add(app.id);
          const detail =
            `A aplicação "${app.name}" ficou unhealthy e já reiniciou 3 vezes nesta hora. ` +
            `O watchdog parou. Verifique a imagem, o healthcheck e os tetos de RAM/CPU.`;
          await AlertService.broadcastNotification(
            `⚠️ App indisponível: ${app.name}`,
            detail,
            'alert',
            true,
            { appId: app.id }
          );
          AuditStore.append({
            action: 'app.health.watchdog.stop',
            outcome: 'failure',
            target: { type: 'app', id: app.id, name: app.name },
            meta: { reason: 'restart-budget' },
          });
          dbStorage.addActivity({
            type: 'alert',
            title: `Watchdog parou: ${app.name}`,
            description: detail,
            status: 'error',
            metadata: { appId: app.id },
          });
        }
        continue;
      }

      if (!decision.restart) continue;

      try {
        await dockerService.restartContainer(app.containerId, client);
        console.warn(`Watchdog: reiniciou ${containerNameForApp(app.name)} após 3 ciclos unhealthy.`);
        AuditStore.append({
          action: 'app.health.restart',
          outcome: 'success',
          target: { type: 'app', id: app.id, name: app.name },
        });
        healthFlipped = true;
      } catch (err: any) {
        console.warn(`Watchdog: falha ao reiniciar ${app.name}:`, err?.message || err);
      }
    }

    if (healthFlipped) {
      try {
        await CaddyService.syncCaddyfile();
      } catch (err: any) {
        console.warn('Watchdog: Caddy sync:', err?.message || err);
      }
    }
  }

  private static async maybeAlertOom(appId: string, appName: string): Promise<void> {
    const last = this.lastOomAlert.get(appId) || 0;
    if (Date.now() - last < OOM_DEBOUNCE_MS) return;
    this.lastOomAlert.set(appId, Date.now());
    const detail =
      `A aplicação "${appName}" foi morta pelo kernel (OOM). ` +
      `Suba o teto de RAM em Aplicações → Configurações → Recursos.`;
    await AlertService.broadcastNotification(`💥 OOM: ${appName}`, detail, 'alert', true, { appId });
    AuditStore.append({
      action: 'app.oom',
      outcome: 'failure',
      target: { type: 'app', id: appId, name: appName },
    });
    dbStorage.addActivity({
      type: 'alert',
      title: `OOM: ${appName}`,
      description: detail,
      status: 'error',
      metadata: { appId },
    });
  }

  private static async clientFor(app: { nodeId?: string }) {
    const nodeId = app.nodeId;
    if (!nodeId || !isRemoteTarget(nodeId, NodeService.getById(nodeId))) return undefined;
    try {
      return await NodeService.getClient(nodeId);
    } catch {
      return undefined;
    }
  }
}
