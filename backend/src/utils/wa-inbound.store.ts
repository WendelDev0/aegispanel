import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

export type InboundOutcome =
  | 'rejected_secret'
  | 'parse_failed'
  | 'no_instance'
  | 'handoff'
  | 'unmatched'
  | 'send_failed'
  | 'handled';

export interface InboundEvent {
  at: string;
  outcome: InboundOutcome;
  instance?: string;
  phoneTail?: string;
  textExcerpt?: string;
  flowId?: string;
  flowName?: string;
  error?: string;
}

const MAX_EVENTS = 80;

function filePath(): string {
  return path.join(CONFIG.DATA_DIR, 'wa-inbound.json');
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

      const current = this.list();
      const events = [next, ...current].slice(0, MAX_EVENTS);
      const dir = path.dirname(filePath());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(filePath(), JSON.stringify({ events }), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* inbound log must never abort the webhook */
    }
  }

  static list(limit = 20): InboundEvent[] {
    const file = filePath();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const events = Array.isArray(parsed?.events) ? parsed.events : [];
      return events.slice(0, Math.max(1, Math.min(80, limit)));
    } catch {
      return [];
    }
  }
}
