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

export function normalizeDomain(domain?: string): string | undefined {
  if (!domain) return undefined;
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return clean || undefined;
}

export function containerNameForDatabase(dbName: string): string {
  return `aegis-db-${dbName.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
}
