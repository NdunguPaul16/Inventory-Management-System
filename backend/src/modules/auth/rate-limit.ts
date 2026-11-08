import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import type { LoginInput } from '@ims/shared';

export interface RateBucket {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(buckets: readonly RateBucket[]): Promise<RateDecision>;
  isReady(): boolean;
}

export interface LoginRatePolicy {
  perIpMinute: number;
  perIpHour: number;
  perAccountFifteenMinutes: number;
}

/** Development/test store. Production uses Redis so all Render instances share counters. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  isReady() {
    return true;
  }

  async consume(buckets: readonly RateBucket[]): Promise<RateDecision> {
    const now = Date.now();
    let retryAfterSeconds = 0;
    for (const bucket of buckets) {
      const current = this.counters.get(bucket.key);
      if (current && current.expiresAt > now && current.count >= bucket.limit) {
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.ceil((current.expiresAt - now) / 1000),
        );
      }
    }
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };
    for (const bucket of buckets) {
      const current = this.counters.get(bucket.key);
      this.counters.set(
        bucket.key,
        current && current.expiresAt > now
          ? { ...current, count: current.count + 1 }
          : { count: 1, expiresAt: now + bucket.windowSeconds * 1000 },
      );
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function canonicalIp(value: string | undefined): string | null {
  if (!value) return null;
  const ip = value.startsWith('::ffff:') ? value.slice(7) : value;
  const version = isIP(ip);
  if (!version) return null;
  return version === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

function key(secret: string, scope: string, value: string) {
  const digest = createHmac('sha256', secret).update(`${scope}\0${value}`).digest('hex');
  return `ims:auth:login:${scope}:${digest}`;
}

/** Runs after body validation and before any account lookup or Argon2 work. */
export function loginRateLimiter(options: {
  store: RateLimitStore;
  keySecret: string;
  policy: LoginRatePolicy;
}): RequestHandler {
  return async (req, res, next) => {
    const ip = canonicalIp(req.ip);
    if (!ip) {
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' },
      });
      return;
    }
    const input = res.locals.validated?.body as LoginInput | undefined;
    if (!input) return next(new Error('Login validation must run before rate limiting'));
    const ipKey = key(options.keySecret, 'ip', ip);
    const accountKey = key(options.keySecret, 'account', input.email);
    try {
      const decision = await options.store.consume([
        { key: `${ipKey}:minute`, limit: options.policy.perIpMinute, windowSeconds: 60 },
        { key: `${ipKey}:hour`, limit: options.policy.perIpHour, windowSeconds: 3600 },
        { key: accountKey, limit: options.policy.perAccountFifteenMinutes, windowSeconds: 900 },
      ]);
      if (!decision.allowed) {
        res
          .status(429)
          .set('Retry-After', String(Math.max(1, decision.retryAfterSeconds)))
          .json({
            error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts; try again later' },
          });
        return;
      }
      next();
    } catch {
      // Never perform an expensive password check when the shared limiter is unavailable.
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' },
      });
    }
  };
}
