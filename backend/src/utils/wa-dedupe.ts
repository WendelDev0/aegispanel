/**
 * Remembers which WhatsApp messages were already processed.
 *
 * Evolution retries a webhook that does not answer quickly, and the panel now
 * answers before running the flow — but a retry can still arrive if the panel
 * restarts mid-turn or the network drops the response. Without this, the
 * retry replays the whole flow: the greeting is sent twice, and a `capture`
 * node consumes the same reply again and advances past the question it was
 * waiting on.
 *
 * In memory on purpose. Persisting would mean a disk write per message to
 * guard against a window that closes in seconds; losing the set on restart
 * costs at most one duplicate.
 */
const MAX_ENTRIES = 1000;
const TTL_MS = 10 * 60 * 1000;

const seenAt = new Map<string, number>();

function prune(now: number): void {
  for (const [key, at] of seenAt) {
    if (now - at >= TTL_MS) seenAt.delete(key);
  }
  // Map preserves insertion order, so the oldest keys are first.
  if (seenAt.size <= MAX_ENTRIES) return;
  const overflow = seenAt.size - MAX_ENTRIES;
  let dropped = 0;
  for (const key of seenAt.keys()) {
    seenAt.delete(key);
    dropped += 1;
    if (dropped >= overflow) break;
  }
}

/**
 * Records the message and reports whether it had already been seen. A payload
 * with no id is never treated as a duplicate: dropping a real message is a
 * silent bot, which is worse than answering one twice.
 */
export function isDuplicateMessage(instance: string, messageId: string | undefined): boolean {
  const id = String(messageId || '').trim();
  if (!id) return false;

  const key = `${instance}__${id}`;
  const now = Date.now();
  const previous = seenAt.get(key);

  if (previous !== undefined && now - previous < TTL_MS) {
    return true;
  }

  seenAt.set(key, now);
  prune(now);
  return false;
}

/** Test seam: the set is process-global. */
export function resetDedupe(): void {
  seenAt.clear();
}
