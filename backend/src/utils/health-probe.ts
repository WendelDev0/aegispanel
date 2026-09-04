/**
 * Health policy for managed applications.
 *
 * A leaf module: the rules here decide whether a deploy is rolled back and
 * whether a container is restarted, so they are kept pure and tested directly
 * rather than inferred from the pipeline that calls them.
 */

export interface HealthcheckConfig {
  /** Path requested on the container's internal port. */
  path: string;
  intervalSec: number;
  timeoutSec: number;
  retries: number;
}

export const DEFAULT_HEALTHCHECK: HealthcheckConfig = {
  path: '/',
  intervalSec: 30,
  timeoutSec: 5,
  retries: 3,
};

export type HealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'unknown';

export interface AppHealth {
  status: HealthStatus;
  checkedAt: string;
  consecutiveFailures: number;
  lastError?: string;
}

/**
 * Only a path, and only one Caddy and Docker will both accept verbatim.
 *
 * Anything else is rejected rather than escaped: this string is interpolated
 * into a `CMD-SHELL` healthcheck, so a value carrying a quote or a `$(` would
 * be evaluated by the container's shell on every interval.
 */
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/?=&%]{0,255}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeHealthcheck(
  input: Partial<HealthcheckConfig> | undefined | null
): HealthcheckConfig {
  const source = input || {};
  const rawPath = typeof source.path === 'string' ? source.path.trim() : '';
  const path = SAFE_PATH.test(rawPath) ? rawPath : DEFAULT_HEALTHCHECK.path;

  const num = (value: unknown, fallback: number) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    path,
    intervalSec: Math.round(clamp(num(source.intervalSec, 30), 5, 3600)),
    timeoutSec: Math.round(clamp(num(source.timeoutSec, 5), 1, 120)),
    retries: Math.round(clamp(num(source.retries, 3), 1, 10)),
  };
}

/**
 * Docker HostConfig.Healthcheck for an app.
 *
 * Opt-in per app, never a default. The probe has to run *inside* the container,
 * and a distroless, scratch or slim image has neither wget nor curl — a default
 * healthcheck would report every such image as unhealthy, and with automatic
 * rollback wired to that signal it would roll back working deploys forever. The
 * panel's own probe (health.service) covers those images instead, from outside.
 *
 * The chain still tries both tools so an image carrying either one works.
 */
export function toDockerHealthcheck(
  config: HealthcheckConfig,
  internalPort: number
): { Test: string[]; Interval: number; Timeout: number; Retries: number; StartPeriod: number } {
  const url = `http://127.0.0.1:${internalPort}${config.path}`;
  const NS = 1_000_000_000;
  return {
    Test: ['CMD-SHELL', `wget -qO- ${url} >/dev/null 2>&1 || curl -fsS ${url} >/dev/null 2>&1`],
    Interval: config.intervalSec * NS,
    Timeout: config.timeoutSec * NS,
    Retries: config.retries,
    // Long enough for a JVM or a Next.js cold start not to be declared dead
    // while it is still booting.
    StartPeriod: 30 * NS,
  };
}

export interface RestartPolicyInput {
  consecutiveFailures: number;
  restartsInLastHour: number;
}

export interface RestartDecision {
  restart: boolean;
  giveUp: boolean;
  reason: string;
}

/** Failures tolerated before the watchdog intervenes. */
export const UNHEALTHY_CYCLES_BEFORE_RESTART = 3;
/** Restarts allowed per hour before the watchdog stops and escalates. */
export const MAX_RESTARTS_PER_HOUR = 3;

/**
 * Whether the watchdog should restart a container.
 *
 * The cap matters more than the trigger. An app that crashes on boot is
 * unhealthy again seconds after every restart, so an uncapped watchdog turns
 * one broken deploy into an endless restart loop that burns CPU and floods the
 * alert channel. After the cap it alerts once and leaves the container alone,
 * which is the state an operator can actually diagnose.
 */
export function decideRestart(input: RestartPolicyInput): RestartDecision {
  if (input.consecutiveFailures < UNHEALTHY_CYCLES_BEFORE_RESTART) {
    return {
      restart: false,
      giveUp: false,
      reason: `Aguardando ${UNHEALTHY_CYCLES_BEFORE_RESTART} ciclos consecutivos (${input.consecutiveFailures}).`,
    };
  }
  if (input.restartsInLastHour >= MAX_RESTARTS_PER_HOUR) {
    return {
      restart: false,
      giveUp: true,
      reason: `Limite de ${MAX_RESTARTS_PER_HOUR} reinícios por hora atingido; intervenção manual necessária.`,
    };
  }
  return { restart: true, giveUp: false, reason: 'Contêiner sem responder; reiniciando.' };
}

/**
 * Whether Caddy should serve this app or a maintenance page.
 *
 * `unknown` routes normally on purpose: it is the state of every app right
 * after the panel restarts, before the first probe has run. Treating it as a
 * failure would take every site offline on each panel restart — a far worse
 * outcome than briefly proxying to an app that turns out to be down.
 */
export function shouldRouteTraffic(status: HealthStatus | undefined): boolean {
  return status !== 'unhealthy';
}
