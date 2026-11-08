import { pino } from 'pino';
import type { RequestHandler } from 'express';
import { createApp } from '../src/app.js';

export const silentLogger = pino({ level: 'silent' });
export const unlimitedTestLoginLimiter: RequestHandler = (_req, _res, next) => next();

export function createTestApp() {
  return createApp({
    logger: silentLogger,
    environment: 'test',
    corsOrigins: ['http://localhost:5173'],
    trustedProxyCidrs: [],
    loginLimiter: unlimitedTestLoginLimiter,
    rateLimitReady: () => true,
    auth: {
      accessTokenSecret: 'test-access-token-secret-that-is-at-least-32-characters',
      refreshTokenSecret: 'test-refresh-token-secret-that-is-at-least-32-characters',
      secureCookies: false,
    },
  });
}
