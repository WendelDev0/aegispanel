export interface ResourceLimits {
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
}

export interface HealthcheckSpec {
  path: string;
  intervalSec: number;
  timeoutSec: number;
  retries: number;
}

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting' | 'none';

export const DEFAULT_APP_LIMITS: ResourceLimits = {
  memoryMb: 512,
  cpus: 1,
  pidsLimit: 256,
};

export const DEFAULT_DB_LIMITS: ResourceLimits = {
  memoryMb: 1024,
  cpus: 2,
  pidsLimit: 256,
};

export const DEFAULT_HEALTHCHECK: HealthcheckSpec = {
  path: '/',
  intervalSec: 30,
  timeoutSec: 5,
  retries: 3,
};

export const HEALTH_WAIT_MS = 120_000;

const NS = 1_000_000_000;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clampAppLimits(
  input?: Partial<ResourceLimits> | null,
  defaults: ResourceLimits = DEFAULT_APP_LIMITS
): ResourceLimits {
  return {
    memoryMb: Math.round(clamp(Number(input?.memoryMb ?? defaults.memoryMb), 32, 65_536)),
    cpus: Math.round(clamp(Number(input?.cpus ?? defaults.cpus), 0.1, 32) * 100) / 100,
    pidsLimit: Math.round(clamp(Number(input?.pidsLimit ?? defaults.pidsLimit), 16, 4096)),
  };
}

export function clampDbLimits(
  input?: Partial<ResourceLimits> | null,
  defaults: ResourceLimits = DEFAULT_DB_LIMITS
): ResourceLimits {
  return clampAppLimits(input, defaults);
}

/** Rejects anything that could become shell metacharacters inside CMD-SHELL. */
export function sanitizeHealthcheckPath(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const path = value.startsWith('/') ? value : `/${value}`;
  if (path.length > 200 || !/^\/[A-Za-z0-9._~/-]*$/.test(path)) return '/';
  return path;
}

export function clampHealthcheck(input?: Partial<HealthcheckSpec> | null): HealthcheckSpec {
  return {
    path: sanitizeHealthcheckPath(input?.path ?? DEFAULT_HEALTHCHECK.path),
    intervalSec: Math.round(clamp(Number(input?.intervalSec ?? DEFAULT_HEALTHCHECK.intervalSec), 5, 300)),
    timeoutSec: Math.round(clamp(Number(input?.timeoutSec ?? DEFAULT_HEALTHCHECK.timeoutSec), 1, 60)),
    retries: Math.round(clamp(Number(input?.retries ?? DEFAULT_HEALTHCHECK.retries), 1, 10)),
  };
}

export interface DockerResources {
  Memory: number;
  MemorySwap: number;
  NanoCpus: number;
  PidsLimit: number;
}

export function toDockerResources(limits: ResourceLimits): DockerResources {
  const memoryBytes = Math.round(limits.memoryMb * 1024 * 1024);
  return {
    Memory: memoryBytes,
    // Equal to Memory disables extra swap. A higher value would let the app
    // escape the RAM cap into swap and hide the OOM the operator configured.
    MemorySwap: memoryBytes,
    NanoCpus: Math.round(limits.cpus * 1e9),
    PidsLimit: limits.pidsLimit,
  };
}

export interface DockerHealthcheck {
  Test: string[];
  Interval: number;
  Timeout: number;
  Retries: number;
  StartPeriod: number;
}

/**
 * wget first (alpine), curl fallback (debian). Distroless images without
 * either fail the check, which is the wanted deploy rollback.
 */
export function healthcheckProbeCommand(internalPort: number, spec: HealthcheckSpec): string {
  const port = Math.round(clamp(internalPort, 1, 65535));
  const path = sanitizeHealthcheckPath(spec.path);
  const url = `http://127.0.0.1:${port}${path}`;
  return `wget -qO- ${url} >/dev/null 2>&1 || curl -sf ${url} >/dev/null || exit 1`;
}

export function toDockerHealthcheck(spec: HealthcheckSpec, internalPort: number): DockerHealthcheck {
  return {
    Test: ['CMD-SHELL', healthcheckProbeCommand(internalPort, spec)],
    Interval: spec.intervalSec * NS,
    Timeout: spec.timeoutSec * NS,
    Retries: spec.retries,
    StartPeriod: 20 * NS,
  };
}

export function describeMemoryOvercommit(opts: {
  hostMemoryMb: number;
  planned: Array<{ name: string; memoryMb: number }>;
}): string | undefined {
  const host = Math.max(0, Math.round(opts.hostMemoryMb));
  if (!host) return undefined;
  const total = opts.planned.reduce((sum, row) => sum + row.memoryMb, 0);
  if (total <= host) return undefined;
  return (
    `A soma dos tetos de RAM (${total} MB) ultrapassa a memória deste host (${host} MB). ` +
    `O painel não bloqueia a criação, mas os apps vão competir e o kernel pode matar o mais pesado.`
  );
}

export function parseContainerHealth(status: string | undefined): ContainerHealth {
  if (status === 'healthy' || status === 'unhealthy' || status === 'starting') return status;
  return 'none';
}
