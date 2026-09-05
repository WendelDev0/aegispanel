/**
 * Evolution outbound webhooks always attach `apikey` — the instance or
 * global Evolution key, not ours. The first inbound after publish used
 * that header as the Aegis secret, ignored `?token=`, and 401'd. The
 * template never ran; the customer only saw whatever else was hooked on
 * the instance (often an echo of the same word).
 */
export function providedWaWebhookSecret(input: {
  aegisHeader?: string;
  queryToken?: string;
}): string {
  const header = String(input.aegisHeader || '').trim();
  if (header) return header;
  return String(input.queryToken || '').trim();
}
