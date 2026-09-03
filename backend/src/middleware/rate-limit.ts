import type { Request, Response, NextFunction, RequestHandler } from 'express';

interface AttemptRecord {
  attempts: number;
  lockUntil?: number;
  updatedAt: number;
}

export interface IpLimiterOptions {
  /** Failed attempts before lockout. */
  maxAttempts: number;
  /** Lockout window in ms. */
  lockTimeMs: number;
  /** How long an idle counter is retained. */
  attemptTtlMs?: number;
  /** Hard cap on tracked IPs. */
  maxTrackedIps?: number;
  /**
   * When true, successful completions clear the counter.
   * Call `clear` from the success path via the returned helpers if you need
   * finer control — the middleware itself only increments on 401 responses
   * when `countOnStatus` is set, otherwise the route calls recordFailure.
   */
}

/**
 * Shared brute-force limiter keyed by req.ip.
 *
 * Extracted from auth.routes so setup and change-password share the same
 * lockout semantics as login, without each route inventing its own Map.
 */
export function createIpLimiter(options: IpLimiterOptions) {
  const {
    maxAttempts,
    lockTimeMs,
    attemptTtlMs = 60 * 60 * 1000,
    maxTrackedIps = 10_000,
  } = options;

  const attempts = new Map<string, AttemptRecord>();

  function prune(now: number): void {
    if (attempts.size < maxTrackedIps) {
      for (const [ip, rec] of attempts) {
        if (now - rec.updatedAt > attemptTtlMs && (!rec.lockUntil || rec.lockUntil < now)) {
          attempts.delete(ip);
        }
      }
      return;
    }
    const sorted = [...attempts.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < sorted.length / 2; i++) {
      attempts.delete(sorted[i][0]);
    }
  }

  function clientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  function isLocked(req: Request): { locked: boolean; retryAfterSec?: number } {
    const now = Date.now();
    prune(now);
    const rec = attempts.get(clientIp(req));
    if (rec?.lockUntil && rec.lockUntil > now) {
      return { locked: true, retryAfterSec: Math.ceil((rec.lockUntil - now) / 1000) };
    }
    return { locked: false };
  }

  function recordFailure(req: Request): void {
    const now = Date.now();
    prune(now);
    const ip = clientIp(req);
    const rec = attempts.get(ip) || { attempts: 0, updatedAt: now };
    rec.attempts += 1;
    rec.updatedAt = now;
    if (rec.attempts >= maxAttempts) {
      rec.lockUntil = now + lockTimeMs;
      rec.attempts = 0;
    }
    attempts.set(ip, rec);
  }

  function clear(req: Request): void {
    attempts.delete(clientIp(req));
  }

  /** Blocks the request when the IP is currently locked out. */
  const guard: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const { locked, retryAfterSec } = isLocked(req);
    if (locked) {
      res.setHeader('Retry-After', String(retryAfterSec || 60));
      res.status(429).json({
        error: `Muitas tentativas. Tente novamente em ${retryAfterSec}s.`,
      });
      return;
    }
    next();
  };

  return { guard, recordFailure, clear, isLocked };
}
