import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Router, type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { z } from '@ims/shared';
import type { Logger } from '../config/logger.js';
import { assertStagingIsolation } from '../config/staging-isolation.js';
import { parseEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/require-permission.js';
import { canonicalIp } from '../modules/auth/rate-limit.js';
import type { AuthConfig } from '../modules/auth/service.js';

// TEMPORARY: remove this router and its environment options after staging validation.
const MAX_ACTIVE_MS = 24 * 60 * 60 * 1_000;
const MAX_FORWARDED_BYTES = 512;
const MAX_FORWARDED_HOPS = 16;

interface DiagnosticRun {
  expiresAt: number;
  key: Buffer;
}

function diagnosticRun(source: NodeJS.ProcessEnv | undefined): DiagnosticRun | null {
  if (source?.STAGING_CLIENT_IP_DIAGNOSTIC_ENABLED !== 'true') return null;
  try {
    // The feature flag alone never authorizes this route, including in production.
    assertStagingIsolation(source);
    const expiry = parseEnv(source).STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT;
    if (!expiry || !z.iso.datetime().safeParse(expiry).success) return null;
    const expiresAt = Date.parse(expiry);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remaining <= 0 || remaining > MAX_ACTIVE_MS) return null;
    return { expiresAt, key: randomBytes(32) };
  } catch {
    return null;
  }
}

function temporaryId(run: DiagnosticRun, address: string | undefined): string | null {
  const ip = canonicalIp(address);
  if (!ip) return null;
  return `p_${createHmac('sha256', run.key).update(ip).digest('hex').slice(0, 24)}`;
}

function forwardedStructure(value: string | string[] | undefined) {
  if (value === undefined) return { forwardedStatus: 'absent', forwardedHopCount: 0 };
  if (typeof value !== 'string' || value.length > MAX_FORWARDED_BYTES)
    return { forwardedStatus: 'malformed', forwardedHopCount: 0 };
  const hops = value.split(',').map((part) => part.trim());
  if (hops.length > MAX_FORWARDED_HOPS || hops.some((part) => !canonicalIp(part)))
    return { forwardedStatus: 'malformed', forwardedHopCount: 0 };
  return { forwardedStatus: 'valid', forwardedHopCount: hops.length };
}

const genericNotFound = { error: { code: 'NOT_FOUND', message: 'Not found' } };

/** Handle diagnostic failures without forwarding thrown values to the normal error logger. */
export const diagnosticErrorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const status =
    error instanceof AppError && error.status === 401
      ? 401
      : error instanceof AppError && error.status === 403
        ? 403
        : 500;
  const body =
    status === 401
      ? { code: 'UNAUTHENTICATED', message: 'Sign in is required' }
      : status === 403
        ? { code: 'FORBIDDEN', message: 'Access denied' }
        : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  try {
    req.log?.[status === 500 ? 'error' : 'warn'](
      { code: body.code, status },
      'Diagnostic request rejected',
    );
  } catch {
    // Logging must never pass the original error to the application's logger.
  }
  let attemptedEnd = false;
  try {
    if (res.headersSent) {
      attemptedEnd = true;
      res.end();
    } else {
      res.status(status).json({ error: body });
    }
  } catch {
    // Do not retry an end that already failed or write after headers were sent.
    if (!attemptedEnd && !res.headersSent) {
      try {
        res.end();
        return;
      } catch {
        // Fall through to socket cleanup.
      }
    }
    try {
      req.socket.destroy();
    } catch {
      // The connection may already be unusable. Never continue the middleware chain.
    }
  }
};

export function clientIpDiagnosticRouter(options: {
  source?: NodeJS.ProcessEnv;
  logger: Logger;
  auth: AuthConfig;
}): Router {
  const router = Router();
  const run = diagnosticRun(options.source);

  // This route never emits the usual pino-http request object or complete headers.
  router.use(
    pinoHttp({
      logger: options.logger,
      autoLogging: false,
      quietReqLogger: true,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  router.use(helmet());
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, private');
    res.set('Pragma', 'no-cache');
    next();
  });
  router.use((req, res, next) => {
    if (!run || Date.now() >= run.expiresAt || req.method !== 'GET' || req.path !== '/') {
      res.status(404).json(genericNotFound);
      return;
    }
    next();
  });
  router.use(authenticate(options.auth));
  router.get('/', requirePermission('*'), (req, res, next) => {
    if (!run) return res.status(404).json(genericNotFound);
    const isAdmin = res.locals.authUser?.roles.some(
      (role) => role.name === 'Admin' && role.isSystem && role.permissions.includes('*'),
    );
    if (!isAdmin) return next(AppError.forbidden());

    const socketPeerId = temporaryId(run, req.socket.remoteAddress);
    const expressClientId = temporaryId(run, req.ip);
    res.json({
      data: {
        diagnosticEnabled: true,
        proxyTrustMode: req.app.get('trust proxy') === false ? 'disabled' : 'explicit',
        socketPeerId,
        expressClientId,
        sameAddress: socketPeerId !== null && socketPeerId === expressClientId,
        ...forwardedStructure(req.headers['x-forwarded-for']),
      },
      meta: {},
    });
  });
  router.use((_req, res) => res.status(404).json(genericNotFound));
  router.use(diagnosticErrorHandler);
  return router;
}
