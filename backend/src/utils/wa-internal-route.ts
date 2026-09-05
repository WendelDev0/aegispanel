import type { AppRecord, ServerNode } from '../db/storage.js';
import { isRemoteTarget, resolveAppUpstream } from './app-upstream.js';
import { normalizeDomain } from './naming.js';

/**
 * Evolution deployed as a panel application sits on the same Docker network
 * as the backend, yet both halves of the WhatsApp loop were addressed by the
 * public hostname: the backend left the bridge, crossed public DNS, TLS and
 * Caddy to reach a container two IPs away, and the webhook came back the same
 * way. That put certificate renewal and DNS in the critical path of a bot
 * reply, and every hop counted against Evolution's webhook timeout.
 *
 * The mapping is not guessed: Caddy's upstream is generated from this same
 * app record, so the container name here is the one already serving the
 * public domain.
 */
export interface InternalRouteSuggestion {
  /** Plain http on the Docker bridge; the traffic never leaves the host. */
  url: string;
  appName: string;
  upstream: string;
}

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Finds the panel application serving `publicApiUrl` and returns the address
 * its neighbours on the Docker network use. Remote-node apps are skipped:
 * they have no presence on the panel's network, so only the public hostname
 * reaches them.
 */
export function suggestInternalEvolutionUrl(
  publicApiUrl: string,
  apps: AppRecord[],
  nodes: ServerNode[] = []
): InternalRouteSuggestion | null {
  const host = hostOf(publicApiUrl);
  if (!host) return null;

  const app = apps.find((candidate) => {
    const domain = normalizeDomain(candidate.domain);
    return Boolean(domain) && domain === normalizeDomain(host);
  });
  if (!app) return null;

  const node = nodes.find((n) => n.id === app.nodeId) || null;
  if (isRemoteTarget(app.nodeId, node)) return null;

  const upstream = resolveAppUpstream(app, node);
  return { url: `http://${upstream}`, appName: app.name, upstream };
}

/**
 * Address the panel answers on from inside the Docker network. Used as the
 * webhook target registered on Evolution when the internal route is enabled.
 */
export function internalPanelBaseUrl(containerName: string, port: number): string {
  return `http://${containerName}:${port}`;
}

/**
 * A verified internal URL wins; anything else falls back to the public one.
 * Kept separate from the probe so the precedence is testable without Docker.
 */
export function preferInternalUrl(publicUrl: string, internalUrl?: string, enabled?: boolean): string {
  if (!enabled) return publicUrl;
  const candidate = String(internalUrl || '').trim();
  if (!candidate) return publicUrl;
  try {
    const parsed = new URL(candidate);
    // Only a bridge address is acceptable here. A public https URL saved into
    // this field would silently reintroduce the hop it exists to remove.
    if (parsed.protocol !== 'http:') return publicUrl;
    return candidate.replace(/\/+$/, '');
  } catch {
    return publicUrl;
  }
}
