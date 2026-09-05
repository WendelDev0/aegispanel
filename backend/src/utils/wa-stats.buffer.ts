/**
 * Pending flow counters, held until a flush.
 *
 * `markRun` wrote through to panel_db.json on every inbound message, and
 * `recordUnmatched` wrote once per bound flow for every message that matched
 * nothing. The panel document is a single JSON file, held in memory and
 * rewritten in full — temp file, fsync, rename — on each mutation, so a busy
 * line rewrote the whole control plane several times a second just to move a
 * counter. That is the exact cost the session store was built to avoid.
 *
 * A leaf module with no storage import: it only accumulates. WaFlowService
 * owns the write, which keeps the flush testable without touching disk.
 */
export interface StatDelta {
  runs: number;
  aiTokens: number;
  errors: number;
  unmatched: number;
}

export interface PendingStat {
  day: string;
  delta: StatDelta;
}

const FLUSH_AFTER_MS = 10_000;

const pending = new Map<string, PendingStat>();
let lastFlushAt = Date.now();

function emptyDelta(): StatDelta {
  return { runs: 0, aiTokens: 0, errors: 0, unmatched: 0 };
}

export class WaStatsBuffer {
  /**
   * Returns true when the caller should flush before this bump: the day
   * rolled over while counts were still pending, and a delta collected
   * yesterday must not land on today's row.
   */
  static dayChanged(flowId: string, day: string): boolean {
    const current = pending.get(flowId);
    return Boolean(current && current.day !== day);
  }

  static bump(flowId: string, day: string, delta: Partial<StatDelta>): void {
    const current = pending.get(flowId);
    const base = current && current.day === day ? current.delta : emptyDelta();
    pending.set(flowId, {
      day,
      delta: {
        runs: base.runs + (delta.runs || 0),
        aiTokens: base.aiTokens + (delta.aiTokens || 0),
        errors: base.errors + (delta.errors || 0),
        unmatched: base.unmatched + (delta.unmatched || 0),
      },
    });
  }

  /** What a read should add on top of the stored record, so the UI is live. */
  static peek(flowId: string): PendingStat | undefined {
    return pending.get(flowId);
  }

  static isDue(now: number = Date.now()): boolean {
    return pending.size > 0 && now - lastFlushAt >= FLUSH_AFTER_MS;
  }

  static hasPending(): boolean {
    return pending.size > 0;
  }

  /** Hands over everything pending and clears it. */
  static drain(): Map<string, PendingStat> {
    const drained = new Map(pending);
    pending.clear();
    lastFlushAt = Date.now();
    return drained;
  }

  /** Test seam: counters are process-global. */
  static reset(): void {
    pending.clear();
    lastFlushAt = Date.now();
  }
}
