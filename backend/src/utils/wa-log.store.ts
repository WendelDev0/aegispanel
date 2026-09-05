import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import type { FlowLogStore, WaTurnLog } from '../services/wa-flow-ports.js';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB per flow ring buffer

export class WaLogStore implements FlowLogStore {
  private static root = path.join(CONFIG.DATA_DIR, 'wa-logs');

  private static fileFor(flowId: string): string {
    const safe = flowId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    return path.join(this.root, `${safe}.jsonl`);
  }

  static appendTurn(turn: WaTurnLog): void {
    try {
      if (!fs.existsSync(this.root)) {
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      }

      const file = this.fileFor(turn.flowId);

      // Enforce PII sanitization: excerpt max 240 chars, ensure phoneHash and phoneTail exist
      const record: WaTurnLog = {
        at: turn.at || new Date().toISOString(),
        instance: String(turn.instance || '').slice(0, 80),
        flowId: turn.flowId,
        phoneHash: turn.phoneHash,
        phoneTail: turn.phoneTail,
        direction: turn.direction,
        nodeId: turn.nodeId ? String(turn.nodeId).slice(0, 64) : undefined,
        nodeType: turn.nodeType ? String(turn.nodeType).slice(0, 32) : undefined,
        textExcerpt: String(turn.textExcerpt || '').slice(0, 240),
        aiModel: turn.aiModel ? String(turn.aiModel).slice(0, 80) : undefined,
        aiTokensIn: typeof turn.aiTokensIn === 'number' ? turn.aiTokensIn : undefined,
        aiTokensOut: typeof turn.aiTokensOut === 'number' ? turn.aiTokensOut : undefined,
        error: turn.error ? String(turn.error).slice(0, 300) : undefined,
      };

      const line = JSON.stringify(record) + '\n';
      fs.appendFileSync(file, line, { encoding: 'utf-8', mode: 0o600 });

      this.enforceCap(file);
    } catch {
      /* best effort: logging failure must never abort flow execution */
    }
  }

  static listTurns(
    flowId: string,
    options?: { limit?: number; cursor?: string }
  ): { turns: WaTurnLog[]; nextCursor?: string } {
    const file = this.fileFor(flowId);
    if (!fs.existsSync(file)) return { turns: [] };

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const total = lines.length;

      const limit = Math.max(1, Math.min(100, options?.limit || 50));
      const offset = options?.cursor ? parseInt(options.cursor, 10) || 0 : 0;

      // Read newest first
      const reversed = lines.reverse();
      const slice = reversed.slice(offset, offset + limit);

      const turns: WaTurnLog[] = [];
      for (const line of slice) {
        try {
          turns.push(JSON.parse(line));
        } catch {
          /* skip corrupted line */
        }
      }

      const nextOffset = offset + limit;
      const nextCursor = nextOffset < total ? String(nextOffset) : undefined;

      return { turns, nextCursor };
    } catch {
      return { turns: [] };
    }
  }

  private static enforceCap(file: string): void {
    try {
      const stat = fs.statSync(file);
      if (stat.size <= MAX_LOG_BYTES) return;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      // Keep newest half of lines
      const kept = lines.slice(Math.floor(lines.length / 2));
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, kept.join('\n') + '\n', { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {
      /* best effort */
    }
  }

  // Instance interface methods
  appendTurn(turn: WaTurnLog): void {
    WaLogStore.appendTurn(turn);
  }

  listTurns(
    flowId: string,
    options?: { limit?: number; cursor?: string }
  ): { turns: WaTurnLog[]; nextCursor?: string } {
    return WaLogStore.listTurns(flowId, options);
  }
}
