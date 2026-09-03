const HOUR_MS = 60 * 60 * 1000;

export const UNHEALTHY_CYCLES_BEFORE_RESTART = 3;
export const MAX_RESTARTS_PER_HOUR = 3;

export interface RestartBudget {
  consecutiveUnhealthy: number;
  restartTimes: number[];
}

export interface RestartDecision {
  restart: boolean;
  exhausted: boolean;
  next: RestartBudget;
}

/**
 * Pure restart policy for an unhealthy container.
 *
 * Three consecutive 8s cycles (~24s) trigger a restart. After three restarts
 * in an hour the watchdog stops and the operator is paged: looping forever
 * would hide a bad image behind a flap.
 */
export function decideUnhealthyRestart(budget: RestartBudget, now = Date.now()): RestartDecision {
  const consecutiveUnhealthy = budget.consecutiveUnhealthy + 1;
  const restartTimes = budget.restartTimes.filter((ts) => now - ts < HOUR_MS);

  if (consecutiveUnhealthy < UNHEALTHY_CYCLES_BEFORE_RESTART) {
    return {
      restart: false,
      exhausted: false,
      next: { consecutiveUnhealthy, restartTimes },
    };
  }

  if (restartTimes.length >= MAX_RESTARTS_PER_HOUR) {
    return {
      restart: false,
      exhausted: true,
      next: { consecutiveUnhealthy, restartTimes },
    };
  }

  return {
    restart: true,
    exhausted: false,
    next: { consecutiveUnhealthy: 0, restartTimes: [...restartTimes, now] },
  };
}
