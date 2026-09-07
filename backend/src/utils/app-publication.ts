import { createHash } from 'node:crypto';
import { isValidDomain, normalizeDomain } from './naming.js';

/** One URL policy for API consumers and the reverse proxy; never infer a
 * public host port from the browser's hostname. IDs keep URLs stable on rename.
 */
export function automaticAppDomain(appId: string, baseDomain: string): string | undefined {
  const base = baseDomain.trim().toLowerCase();
  if (!base) return undefined;
  if (!isValidDomain(base) || base.includes('*') || base !== normalizeDomain(base) || !base.includes('.')) {
    throw new Error('AEGIS_APPS_BASE_DOMAIN deve ser um domínio-base DNS, sem protocolo, porta ou wildcard.');
  }
  const label = `app-${createHash('sha256').update(appId).digest('hex').slice(0, 20)}`;
  const hostname = `${label}.${base}`;
  if (hostname.length > 253) throw new Error('AEGIS_APPS_BASE_DOMAIN excede o tamanho permitido para o hostname da aplicação.');
  return hostname;
}

export function appPublication(app: { id: string; domain?: string }, baseDomain: string): {
  automaticDomain?: string;
  publicUrl?: string;
} {
  const automaticDomain = automaticAppDomain(app.id, baseDomain);
  const custom = normalizeDomain(app.domain);
  const hostname = custom && isValidDomain(custom) && !custom.includes('*') ? custom : automaticDomain;
  return { automaticDomain, publicUrl: hostname ? `https://${hostname}` : undefined };
}
