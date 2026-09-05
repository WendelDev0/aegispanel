import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

export type InboundOutcome =
  | 'rejected_secret'
  | 'parse_failed'
  | 'no_text'
  | 'no_instance'
  | 'handoff'
  | 'unmatched'
  | 'send_failed'
  | 'handled';

/** Traffic the panel drops by design; counted, never listed. */
export type InboundSkipCounter = 'group' | 'broadcast' | 'newsletter' | 'from_me';

export interface InboundEvent {
  at: string;
  outcome: InboundOutcome;
  instance?: string;
  phoneTail?: string;
  textExcerpt?: string;
  flowId?: string;
  flowName?: string;
  error?: string;
  /** How many consecutive identical config failures collapsed into this one. */
  repeated?: number;
}

export interface InboundSkipSummary {
  since: string;
  group: number;
  broadcast: number;
  newsletter: number;
  from_me: number;
  total: number;
}

const MAX_EVENTS = 80;

/**
 * A wrong webhook secret or a missing instance repeats identically on every
 * ping. Listing each one filled the ring with the same line and hid the
 * conversation underneath it. Outcomes that describe *the panel's* config
 * collapse; outcomes that describe a conversation never do, because two
 * messages from the same person are two different facts.
 */
const COLLAPSIBLE: ReadonlySet<InboundOutcome> = new Set<InboundOutcome>([
  'rejected_secret',
  'parse_failed',
  'no_instance',
]);

/**
 * Counters live in memory on purpose. A published instance is usually the
 * operator's own line, so group pings arrive constantly — persisting each
 * one meant rewriting this whole file per WhatsApp group message. The
 * numbers reset on restart, which `since` makes explicit.
 */
const skipped: Record<InboundSkipCounter, number> = {
  group: 0,
  broadcast: 0,
  newsletter: 0,
  from_me: 0,
};
let skippedSince = new Date().toISOString();

function filePath(): string {
  return path.join(CONFIG.DATA_DIR, 'wa-inbound.json');
}

function sameSubject(a: InboundEvent, b: InboundEvent): boolean {
  return (
    a.outcome === b.outcome &&
    a.instance === b.instance &&
    a.phoneTail === b.phoneTail &&
    a.flowId === b.flowId &&
    a.error === b.error
  );
}

/**
 * Last inbound outcomes live next to DATA_DIR, not in panel_db.json.
 * Conversation traffic in the panel document would rewrite the whole
 * control plane on every WhatsApp ping.
 */
export class WaInboundStore {
  static record(event: Omit<InboundEvent, 'at'> & { at?: string }): void {
    try {
      const next: InboundEvent = {
        at: event.at || new Date().toISOString(),
        outcome: event.outcome,
        instance: event.instance ? String(event.instance).slice(0, 80) : undefined,
        phoneTail: event.phoneTail ? String(event.phoneTail).slice(0, 8) : undefined,
        textExcerpt: event.textExcerpt ? String(event.textExcerpt).slice(0, 160) : undefined,
        flowId: event.flowId ? String(event.flowId).slice(0, 80) : undefined,
        flowName: event.flowName ? String(event.flowName).slice(0, 80) : undefined,
        error: event.error ? String(event.error).slice(0, 300) : undefined,
      };

      const current = this.list(MAX_EVENTS);
      const head = current[0];
      let events: InboundEvent[];

      if (head && COLLAPSIBLE.has(next.outcome) && sameSubject(head, next)) {
        events = [{ ...next, repeated: (head.repeated || 1) + 1 }, ...current.slice(1)];
      } else {
        events = [next, ...current].slice(0, MAX_EVENTS);
      }

      const dir = path.dirname(filePath());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(filePath(), JSON.stringify({ events }), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* inbound log must never abort the webhook */
    }
  }

  static countSkipped(reason: InboundSkipCounter): void {
    skipped[reason] += 1;
  }

  static skipSummary(): InboundSkipSummary {
    return {
      since: skippedSince,
      group: skipped.group,
      broadcast: skipped.broadcast,
      newsletter: skipped.newsletter,
      from_me: skipped.from_me,
      total: skipped.group + skipped.broadcast + skipped.newsletter + skipped.from_me,
    };
  }

  /** Test seam: counters are process-global. */
  static resetSkipped(): void {
    skipped.group = 0;
    skipped.broadcast = 0;
    skipped.newsletter = 0;
    skipped.from_me = 0;
    skippedSince = new Date().toISOString();
  }

  static list(limit = 20): InboundEvent[] {
    const file = filePath();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const events = Array.isArray(parsed?.events) ? parsed.events : [];
      return events.slice(0, Math.max(1, Math.min(MAX_EVENTS, limit)));
    } catch {
      return [];
    }
  }
}
