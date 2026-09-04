/**
 * Resource ceilings for managed containers.
 *
 * Until now containers were created with `RestartPolicy` and nothing else, so
 * a single workload could take the whole host: a build loop that leaks memory,
 * a runaway dev server, a fork bomb in a dependency's postinstall. The panel
 * showed CPU and RAM per app but had no way to cap them, and the machine that
 * died took the panel down with it — the operator could not even open the UI
 * to stop the offending app.
 *
 * A leaf module on purpose: both the storage schema and the Docker service
 * need these shapes, and neither may import the other.
 */

export interface ResourceLimits {
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
}

/**
 * Deliberately modest. An app that needs more says so explicitly; the failure
 * mode of a low ceiling is one container restarting, and the failure mode of no
 * ceiling is the whole VPS.
 */
export const DEFAULT_APP_LIMITS: ResourceLimits = {
  memoryMb: 512,
  cpus: 1,
  pidsLimit: 256,
};

/** Engines buffer aggressively and fork per connection, so they start higher. */
export const DEFAULT_DATABASE_LIMITS: ResourceLimits = {
  memoryMb: 1024,
  cpus: 2,
  pidsLimit: 512,
};

/**
 * Docker refuses to create a container under 6 MB, and anything near that
 * cannot start a runtime. 64 MB is the lowest value that fails as "your app
 * needs more memory" instead of "the container never started".
 */
const MIN_MEMORY_MB = 64;
const MAX_MEMORY_MB = 1024 * 1024; // 1 TB, well past any single VPS
const MIN_CPUS = 0.1;
const MAX_CPUS = 256;
const MIN_PIDS = 16;
const MAX_PIDS = 32_768;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteOr(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

/**
 * Coerces a partial or untrusted value into usable limits.
 *
 * Values reach here from the API and from records written by older versions,
 * so a missing or nonsensical field falls back rather than reaching the Docker
 * daemon: a `Memory` of 0 means "unlimited" to Docker, which is the exact
 * opposite of what a user typing 0 intends.
 */
export function normalizeLimits(
  input: Partial<ResourceLimits> | undefined | null,
  fallback: ResourceLimits = DEFAULT_APP_LIMITS
): ResourceLimits {
  const source = input || {};
  return {
    memoryMb: Math.round(
      clamp(finiteOr(source.memoryMb, fallback.memoryMb), MIN_MEMORY_MB, MAX_MEMORY_MB)
    ),
    // Two decimals: Docker takes NanoCpus, so 0.25 cpu is meaningful, but
    // storing 0.3333333 makes the UI show a value the user never typed.
    cpus: Math.round(clamp(finiteOr(source.cpus, fallback.cpus), MIN_CPUS, MAX_CPUS) * 100) / 100,
    pidsLimit: Math.round(
      clamp(finiteOr(source.pidsLimit, fallback.pidsLimit), MIN_PIDS, MAX_PIDS)
    ),
  };
}

export interface HostConfigLimits {
  Memory: number;
  MemorySwap: number;
  NanoCpus: number;
  PidsLimit: number;
}

/**
 * Maps limits onto Docker's HostConfig fields.
 *
 * `MemorySwap` equals `Memory` on purpose: leaving it unset lets the container
 * use swap equal to twice its memory, so a leaking process thrashes the host's
 * disk for minutes instead of being killed. Equal values mean no swap at all —
 * the kernel OOM-kills the container the moment it passes its ceiling, which is
 * the behaviour the limit was set for.
 */
export function toHostConfigLimits(limits: ResourceLimits): HostConfigLimits {
  const memoryBytes = limits.memoryMb * 1024 * 1024;
  return {
    Memory: memoryBytes,
    MemorySwap: memoryBytes,
    NanoCpus: Math.round(limits.cpus * 1e9),
    PidsLimit: limits.pidsLimit,
  };
}

/** Total memory promised to a set of workloads, in MB. */
export function committedMemoryMb(limits: Array<ResourceLimits | undefined>): number {
  return limits.reduce((total, item) => total + (item ? item.memoryMb : 0), 0);
}

export interface OvercommitWarning {
  committedMb: number;
  hostTotalMb: number;
  ratio: number;
}

/**
 * Reports when the ceilings promised across all workloads exceed the host's RAM.
 *
 * A warning, never a block: overcommit is normal and usually fine — workloads
 * rarely peak together — and refusing the creation would be the panel second
 * guessing an operator who knows their own traffic. What is not fine is finding
 * out during an incident that nobody ever did the arithmetic.
 */
export function overcommitWarning(
  committedMb: number,
  hostTotalMb: number
): OvercommitWarning | null {
  if (!Number.isFinite(hostTotalMb) || hostTotalMb <= 0) return null;
  if (committedMb <= hostTotalMb) return null;
  return {
    committedMb,
    hostTotalMb: Math.round(hostTotalMb),
    ratio: Math.round((committedMb / hostTotalMb) * 100) / 100,
  };
}
