/**
 * Serialises async work per key.
 *
 * A WhatsApp conversation is a state machine stored in one file per contact.
 * Two messages arriving close together both read the session, both walk the
 * flow from the same node, and the slower one's write wins — the customer
 * answers a menu twice and the bot repeats the same question. Answering the
 * webhook before processing (so Evolution stops retrying) widens that window
 * from milliseconds to the length of a whole flow run, which is why the two
 * changes belong together.
 *
 * Keyed by conversation, never global: a slow AI call for one contact must
 * not hold up everyone else's replies.
 */
const chains = new Map<string, Promise<unknown>>();

export function runSerial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();

  // Both handlers run `task`: a turn that threw must not wedge the queue for
  // that contact, it just means the next message starts from stored state.
  const result = previous.then(task, task);

  const link: Promise<void> = result.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, link);

  void link.then(() => {
    // Only the tail clears itself. Deleting unconditionally would drop a
    // newer link queued behind this one and reopen the race it prevents.
    if (chains.get(key) === link) chains.delete(key);
  });

  return result;
}

/** Test seam: how many conversations still have work queued. */
export function pendingSerialKeys(): number {
  return chains.size;
}
