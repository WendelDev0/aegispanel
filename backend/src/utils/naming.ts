import net from 'node:net';

/**
 * Naming rules shared by the deploy pipeline, the app service and the Caddy
 * generator.
 *
 * Kept in a leaf module with no service imports: these three used to derive
 * the container name with three separate copies of the same regex, which is
 * how a rename ended up orphaning a running container.
 */

export function containerNameForApp(appName: string): string {
  return `aegis-app-${appName.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}

export function containerNameForAppProcess(appName: string, processName: string): string {
  const proc = processName.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'proc';
  return `${containerNameForApp(appName)}-${proc}`;
}

export function containerNameForAppSlot(appName: string, deploymentId: string): string {
  const slot = deploymentId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(-12) || 'slot';
  return `${containerNameForApp(appName)}--${slot}`;
}

export function normalizeDomain(domain?: string): string | undefined {
  if (!domain) return undefined;
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return clean || undefined;
}

const HOSTNAME = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Domain names only; IP literals are not valid application hostnames here. */
export function isValidDomain(domain?: string): boolean {
  const clean = normalizeDomain(domain);
  return Boolean(clean && HOSTNAME.test(clean) && !net.isIP(clean));
}

export function containerNameForDatabase(dbName: string): string {
  return `aegis-db-${dbName.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}
