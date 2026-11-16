import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { LoginInput } from '@ims/shared';
import { assertStagingIsolation } from '../config/staging-isolation.js';
import type { RateLimitStore } from '../modules/auth/rate-limit.js';

export const LOGIN_PATH = '/api/v1/auth/login';
export const ASSERTION_HEADER = 'x-ims-staging-login-assertion';
const MAX_AGE_MS = 30_000;
const MAX_FUTURE_MS = 5_000;
const NONCE_TTL_SECONDS = 60;
const ASSERTION = /^v1\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})\.([a-f0-9]{64})$/;
const PRIVATE_HEADERS = new Set([
  ASSERTION_HEADER,
  'authorization',
  'cookie',
  'forwarded',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
]);

function secret(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Staging login identity configuration is invalid');
  }
  return Buffer.from(value, 'hex');
}

function material(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  identity: string,
  bodyHash: string,
): string {
  return ['ims-login-v1', method, path, timestamp, nonce, identity, bodyHash].join('\n');
}

function safeFailure(res: Response, status: 403 | 503): void {
  res
    .status(status)
    .set('Cache-Control', 'no-store')
    .json({
      error:
        status === 403
          ? { code: 'FORBIDDEN', message: 'Sign-in is unavailable through this route' }
          : { code: 'SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' },
    });
}

/** Only the staging entry point imports this module. The ordinary backend build excludes it. */
export function createStagingLoginIdentity(options: {
  source: NodeJS.ProcessEnv;
  store: RateLimitStore;
  now?: () => number;
}): {
  capture: RequestHandler;
  admit: RequestHandler;
  clientIdentity: (req: Request) => string | null;
} {
  assertStagingIsolation(options.source);
  const current = secret(options.source.STAGING_LOGIN_GATEWAY_KEY_CURRENT);
  const previousValue = options.source.STAGING_LOGIN_GATEWAY_KEY_PREVIOUS;
  const previous = previousValue ? secret(previousValue) : null;
  if (previous && timingSafeEqual(current, previous)) {
    throw new Error('Staging login identity configuration is invalid');
  }
  const captured = new WeakMap<Request, string>();
  const admitted = new WeakMap<Request, string>();
  const now = options.now ?? Date.now;

  const capture: RequestHandler = (req, res, next) => {
    // Express accepts case and trailing-slash variants of this route by default.
    // Handle them before the request logger, then reject anything but the signed path.
    if (req.method !== 'POST' || !/^\/api\/v1\/auth\/login\/?$/i.test(req.path)) return next();
    const value = req.headers[ASSERTION_HEADER];
    // Login does not use these headers. Remove them before pino-http serializes
    // the request so neither the signed identity nor raw forwarding data is logged.
    for (const name of PRIVATE_HEADERS) delete req.headers[name];
    for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
      if (PRIVATE_HEADERS.has(req.rawHeaders[index]?.toLowerCase() ?? '')) {
        req.rawHeaders.splice(index, 2);
      }
    }
    if (req.originalUrl !== LOGIN_PATH || typeof value !== 'string' || value.length > 256) {
      safeFailure(res, 403);
      return;
    }
    captured.set(req, value);
    next();
  };

  const admit: RequestHandler = async (req, res, next) => {
    const value = captured.get(req);
    captured.delete(req);
    const match = value?.match(ASSERTION);
    if (!match) {
      safeFailure(res, 403);
      return;
    }
    const [, timestamp, nonce, identity, signature] = match;
    if (!timestamp || !nonce || !identity || !signature) {
      safeFailure(res, 403);
      return;
    }
    const issuedAt = Number(timestamp);
    const age = now() - issuedAt;
    if (!Number.isSafeInteger(issuedAt) || age < -MAX_FUTURE_MS || age > MAX_AGE_MS) {
      safeFailure(res, 403);
      return;
    }
    const input = res.locals.validated?.body as LoginInput | undefined;
    if (!input) {
      safeFailure(res, 503);
      return;
    }
    const bodyHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const signed = material(req.method, req.originalUrl, timestamp, nonce, identity, bodyHash);
    const supplied = Buffer.from(signature, 'hex');
    const validCurrent = timingSafeEqual(
      supplied,
      createHmac('sha256', current).update(signed).digest(),
    );
    const validPrevious = previous
      ? timingSafeEqual(supplied, createHmac('sha256', previous).update(signed).digest())
      : false;
    if (!validCurrent && !validPrevious) {
      safeFailure(res, 403);
      return;
    }
    try {
      // An assertion signed by the previous key retains its nonce slot across rotation.
      const verifiedKey = validCurrent ? current : previous!;
      const nonceKey = createHmac('sha256', verifiedKey).update(`nonce\0${nonce}`).digest('hex');
      const decision = await options.store.consume([
        {
          key: `ims:auth:login-gateway:nonce:${nonceKey}`,
          limit: 1,
          windowSeconds: NONCE_TTL_SECONDS,
        },
      ]);
      if (!decision.allowed) {
        safeFailure(res, 403);
        return;
      }
    } catch {
      safeFailure(res, 503);
      return;
    }
    admitted.set(req, identity);
    next();
  };

  return {
    capture,
    admit,
    clientIdentity: (req) => admitted.get(req) ?? null,
  };
}
