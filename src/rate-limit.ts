/**
 * Fixed-window, in-memory rate limiter keyed by an arbitrary string (we key by
 * connection id). One process only, which matches the single-instance design;
 * if we ever scale horizontally this moves to Redis alongside the Postgres
 * migration.
 */
interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (window.count >= this.max) {
      return { allowed: false, retryAfterMs: window.resetAt - now };
    }
    window.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop expired windows so the map stays bounded by active keys. */
  sweep(now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
