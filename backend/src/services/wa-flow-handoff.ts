import { WaHandoffStore } from '../utils/wa-handoff.store.js';

/**
 * Active human handoffs. Backed by disk: a restart used to drop them all and
 * the bot resumed talking over an attendant mid-conversation, with nothing in
 * the logs to say why.
 *
 * Its own module because both the engine and the handoff block need it, and
 * importing the engine from a block handler would close the cycle
 * engine → handlers → engine.
 */
export class HandoffManager {
  static set(instance: string, pHash: string, minutes = 120): void {
    const expiresAt = Date.now() + Math.max(5, Math.min(1440, minutes)) * 60 * 1000;
    WaHandoffStore.set(instance, pHash, expiresAt);
  }

  static isActive(instance: string, pHash: string): boolean {
    return WaHandoffStore.isActive(instance, pHash);
  }

  static release(instance: string, pHash: string): boolean {
    return WaHandoffStore.release(instance, pHash);
  }

  static list(): Array<{ instance: string; phoneHash: string; expiresAt: string }> {
    return WaHandoffStore.list();
  }

  static clear(): void {
    WaHandoffStore.clear();
  }
}
