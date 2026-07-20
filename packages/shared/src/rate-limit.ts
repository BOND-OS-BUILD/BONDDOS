import 'server-only';

import { RateLimitError } from './errors';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit?: number;
  /** Window size, in seconds. */
  windowSeconds?: number;
}

/**
 * Rate limiter abstraction (fixed-window). Ships with an in-memory
 * implementation suitable for local dev / single-instance deploys. Swap in a
 * Redis-backed implementation (e.g. via @bond-os/shared's `getCache` Redis
 * client) once running multiple instances, without changing call sites.
 */
export interface RateLimiter {
  consume(key: string, opts?: RateLimitOptions): Promise<RateLimitResult>;
}

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_SECONDS = 60;

class InMemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  async consume(key: string, opts: RateLimitOptions = {}): Promise<RateLimitResult> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const windowMs = (opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000;
    const now = Date.now();

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { success: true, limit, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (existing.count >= limit) {
      return { success: false, limit, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return { success: true, limit, remaining: limit - existing.count, resetAt: existing.resetAt };
  }
}

let instance: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (!instance) {
    instance = new InMemoryRateLimiter();
  }
  return instance;
}

/** Extracts a best-effort client IP from a standard Fetch API Request. */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Wraps a Next.js Route Handler with rate limiting keyed by client IP (or a
 * custom key). Throws `RateLimitError`, which `apiHandler` (apps/web)
 * translates into a 429 JSON response.
 */
export function withRateLimit<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
  opts: RateLimitOptions & { keyFn?: (request: Request) => string } = {},
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const key = opts.keyFn ? opts.keyFn(request) : getClientIp(request);
    const result = await getRateLimiter().consume(`${new URL(request.url).pathname}:${key}`, opts);
    if (!result.success) {
      throw new RateLimitError();
    }
    return handler(request, ...args);
  };
}
