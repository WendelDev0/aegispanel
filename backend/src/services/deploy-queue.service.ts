import { dbStorage, AppRecord, DeploymentRecord } from '../db/storage.js';
import { LOCAL_NODE_ID } from './node.service.js';
import { emit } from '../realtime.js';
import { AuditStore } from '../utils/audit.store.js';
import {
  admit,
  nextRunnable,
  positionInQueue,
  type QueueEntry,
} from '../utils/deploy-queue.js';

/**
 * Runs deploys one at a time per node.
 *
 * Before this, a second deploy of the same app simply threw ("já existe um
 * deploy em execução") — which is correct for a button click and wrong for a
 * webhook: a push during a build was dropped, so the panel silently ran an
 * older commit than the branch head. Requests are now queued and the newest one
 * for an app replaces the waiting one, so a burst of pushes deploys the latest
 * commit exactly once instead of building every commit in between.
 */

export interface DeployRequest {
  commitHash?: string;
  commitMessage?: string;
  authorName?: string;
  branch?: string;
  triggeredBy: 'webhook' | 'manual' | 'github_action';
}

interface QueuedPayload {
  app: AppRecord;
  request: DeployRequest;
  resolve: (deployment: DeploymentRecord) => void;
  reject: (err: Error) => void;
}

/**
 * The panel's own host may run two: it is the machine the operator sized for
 * this, and one of the two slots is usually a small image pull rather than a
 * full build. A remote node stays at one — the panel cannot see how loaded it
 * already is.
 */
const LOCAL_CONCURRENCY = 2;
const REMOTE_CONCURRENCY = 1;

export class DeployQueueService {
  private static queue: Array<QueueEntry<QueuedPayload>> = [];
  private static running: Array<QueueEntry<QueuedPayload>> = [];
  private static runner:
    | ((app: AppRecord, request: DeployRequest, deploymentId: string) => Promise<DeploymentRecord>)
    | null = null;

  /**
   * Injected instead of imported: CicdService already imports this module to
   * enqueue, and importing it back would be a cycle.
   */
  static setRunner(
    runner: (app: AppRecord, request: DeployRequest, deploymentId: string) => Promise<DeploymentRecord>
  ): void {
    this.runner = runner;
  }

  private static concurrencyFor(nodeId: string): number {
    return nodeId === LOCAL_NODE_ID ? LOCAL_CONCURRENCY : REMOTE_CONCURRENCY;
  }

  /** Snapshot for the UI: what is building and what is waiting behind it. */
  static status(): {
    running: Array<{ deploymentId: string; appId: string; nodeId: string }>;
    queued: Array<{ deploymentId: string; appId: string; nodeId: string; position: number }>;
  } {
    return {
      running: this.running.map((entry) => ({
        deploymentId: entry.id,
        appId: entry.appId,
        nodeId: entry.nodeId,
      })),
      queued: this.queue.map((entry) => ({
        deploymentId: entry.id,
        appId: entry.appId,
        nodeId: entry.nodeId,
        position: positionInQueue(this.queue, entry.id),
      })),
    };
  }

  static positionOf(deploymentId: string): number {
    return positionInQueue(this.queue, deploymentId);
  }

  /**
   * Cancels a deploy that has not started.
   *
   * Only a queued one. A running deploy may be mid-swap — the previous
   * container renamed aside, the new one starting — and killing it there leaves
   * the app with neither.
   */
  static cancel(deploymentId: string): boolean {
    const index = this.queue.findIndex((entry) => entry.id === deploymentId);
    if (index < 0) return false;

    const [entry] = this.queue.splice(index, 1);
    this.markCancelled(entry, 'Cancelado antes de iniciar.');
    entry.payload.reject(new Error('Deploy cancelado antes de iniciar.'));
    this.emitStatus();
    return true;
  }

  private static markCancelled(entry: QueueEntry<QueuedPayload>, reason: string): void {
    const record = dbStorage.getDeploymentById(entry.appId, entry.id);
    if (!record) return;
    dbStorage.saveDeployment({
      ...record,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      buildLogs: `[${new Date().toISOString()}] ⏹️ ${reason}\n`,
    });
  }

  private static emitStatus(): void {
    emit('deploy:queue', this.status());
  }

  /**
   * Queues a deploy and resolves when it has run.
   *
   * The promise deliberately spans the wait: callers (the route, the webhook)
   * already treat executeDeploy as "this finishes when the deploy finishes", and
   * a queued deploy that resolved immediately would report success before
   * anything was built.
   */
  static enqueue(
    app: AppRecord,
    request: DeployRequest,
    deployment: DeploymentRecord
  ): Promise<DeploymentRecord> {
    if (!this.runner) {
      return Promise.reject(new Error('Fila de deploy não inicializada.'));
    }

    return new Promise<DeploymentRecord>((resolve, reject) => {
      const entry: QueueEntry<QueuedPayload> = {
        id: deployment.id,
        appId: app.id,
        nodeId: app.nodeId || LOCAL_NODE_ID,
        enqueuedAtMs: Date.now(),
        payload: { app, request, resolve, reject },
      };

      const decision = admit(this.queue, new Set(this.running.map((r) => r.appId)), entry);

      // A burst of pushes is one intent: deploy the newest commit. Building the
      // commits in between spends minutes to publish states nobody asked to see.
      if (decision.supersededId) {
        const index = this.queue.findIndex((q) => q.id === decision.supersededId);
        if (index >= 0) {
          const [superseded] = this.queue.splice(index, 1);
          this.markCancelled(superseded, 'Substituído por um push mais recente.');
          superseded.payload.reject(
            new Error('Deploy substituído por um pedido mais recente da mesma aplicação.')
          );
          AuditStore.append({
            action: 'deploy.superseded',
            outcome: 'success',
            target: { type: 'app', id: app.id, name: app.name },
            meta: { supersededDeploymentId: superseded.id, replacedBy: deployment.id },
          });
        }
      }

      this.queue.push(entry);
      this.emitStatus();
      this.pump();
    });
  }

  /** Starts whatever may start now. Safe to call repeatedly. */
  private static pump(): void {
    if (!this.runner) return;

    for (;;) {
      const next = nextRunnable(this.queue, this.running, (nodeId) => this.concurrencyFor(nodeId));
      if (!next) return;

      this.queue = this.queue.filter((entry) => entry.id !== next.id);
      this.running.push(next);
      this.emitStatus();

      const { app, request, resolve, reject } = next.payload;
      this.runner(app, request, next.id)
        .then(resolve, reject)
        .finally(() => {
          this.running = this.running.filter((entry) => entry.id !== next.id);
          this.emitStatus();
          // Recursion, not a loop: the slot this deploy held is only free now.
          this.pump();
        });
    }
  }

  /** Drops everything on shutdown so pending promises do not hang. */
  static clear(): void {
    for (const entry of this.queue) {
      entry.payload.reject(new Error('Painel encerrando; deploy na fila cancelado.'));
    }
    this.queue = [];
  }
}
