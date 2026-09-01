import type { PanelSettings } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { isValidDomain, normalizeDomain } from './naming.js';

function normalizeConfiguredUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const allowedProtocol = url.protocol === 'https:' || (CONFIG.LOCAL_MODE && url.protocol === 'http:');
    if (!allowedProtocol || url.username || url.password || url.search || url.hash) return null;

    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

/**
 * Resolves a canonical URL without trusting Host/X-Forwarded-Host from a
 * request. Production deployments should set AEGIS_PUBLIC_BASE_URL; the
 * saved panel domain is a safe fallback because it is admin-controlled.
 */
export function getPublicBaseUrl(settings: Pick<PanelSettings, 'panelDomain'>): string | null {
  if (CONFIG.PUBLIC_BASE_URL) return normalizeConfiguredUrl(CONFIG.PUBLIC_BASE_URL);

  const panelDomain = normalizeDomain(settings.panelDomain);
  if (panelDomain && isValidDomain(panelDomain)) {
    return `${CONFIG.LOCAL_MODE ? 'http' : 'https'}://${panelDomain}`;
  }

  return CONFIG.IS_PRODUCTION ? null : `http://localhost:${CONFIG.PORT}`;
}
