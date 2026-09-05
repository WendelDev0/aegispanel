/**
 * Serialises deploys per target node.
 *
 * Two builds on the same Docker daemon fight for it: they compete for CPU and
 * disk, and on a small VPS a second `docker build` starting mid-way through the
 * first is what turns a slow deploy into a failed one. Worse, two deploys of the
 * *same* app race over one container name and one host port — the second create
 * renames the first's container aside while the first is still starting it.
 *
 * A leaf module holding only the queue's decisions, so ordering and admission
 * are tested without running a pipeline.
 */

export interface QueueEntry<T = unknown> {
  /** Deployment id; unique per queued item. */
  id: string;
  /** Only one deploy per app+lane may be queued at a time. */
  appId: string;
  /** Serialisation domain. Deploys on different nodes never block each other. */
  nodeId: string;
  /**
   * Production and a preview of the same app must not supersede each other:
   * they target different containers. Default is production.
   */
  lane?: string;
  enqueuedAtMs: number;
  payload: T;
}

export interface AdmissionResult {
  admitted: boolean;
  /** Set when a queued entry for the same app was superseded by this one. */
  supersededId?: string;
  reason?: string;
}

/**
 * Decides what happens to a new request for an app that already has one waiting.
 *
 * Collapses rather than queues. Five pushes in a minute is one intent — deploy
 * the latest commit — and building the three commits in between wastes minutes
 * of build time to publish states nobody asked to see. The running deploy is
 * never touched: it may already be halfway through a container swap.
 */
export function admit<T>(
  queue: Array<QueueEntry<T>>,
  running: Set<string>,
  candidate: QueueEntry<T>
): AdmissionResult {
  if (running.has(candidate.appId)) {
    // Still admitted: it waits for the running one to finish, and collapses
    // against any other waiter for the same app below.
  }

  const lane = candidate.lane || 'production';
  const existing = queue.find(
    (entry) => entry.appId === candidate.appId && (entry.lane || 'production') === lane
  );
  if (existing) {
    return {
      admitted: true,
      supersededId: existing.id,
      reason: 'Pedido anterior desta aplicação ainda não começou; foi substituído pelo mais recente.',
    };
  }

  return { admitted: true };
}

/**
 * The next entry that may start, or null.
 *
 * FIFO within a node, and never two for the same app: the in-flight set is
 * consulted as well as the per-node concurrency, because an app can be running
 * on one node while a later request for it waits behind a different one.
 */
export function nextRunnable<T>(
  queue: Array<QueueEntry<T>>,
  running: Array<QueueEntry<T>>,
  concurrencyFor: (nodeId: string) => number
): QueueEntry<T> | null {
  const runningPerNode = new Map<string, number>();
  const runningLanes = new Set<string>();
  for (const entry of running) {
    runningPerNode.set(entry.nodeId, (runningPerNode.get(entry.nodeId) || 0) + 1);
    runningLanes.add(`${entry.appId}::${entry.lane || 'production'}`);
  }

  const fifo = [...queue].sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  for (const entry of fifo) {
    if (runningLanes.has(`${entry.appId}::${entry.lane || 'production'}`)) continue;
    if ((runningPerNode.get(entry.nodeId) || 0) >= concurrencyFor(entry.nodeId)) continue;
    return entry;
  }

  return null;
}

/** 1-based position of an entry in its node's queue, or 0 when absent. */
export function positionInQueue<T>(queue: Array<QueueEntry<T>>, id: string): number {
  const fifo = [...queue].sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
  const index = fifo.findIndex((entry) => entry.id === id);
  if (index < 0) return 0;

  // Position among entries for the same node: a deploy waiting behind another
  // node's queue is not actually behind it.
  const nodeId = fifo[index].nodeId;
  return fifo.slice(0, index + 1).filter((entry) => entry.nodeId === nodeId).length;
}
