import { pino } from 'pino';
import { createApp } from '../src/app.js';

export const silentLogger = pino({ level: 'silent' });

export function createTestApp() {
  return createApp({
    logger: silentLogger,
    environment: 'test',
    corsOrigins: ['http://localhost:5173'],
    auth: {
      accessTokenSecret: 'test-access-token-secret-that-is-at-least-32-characters',
      refreshTokenSecret: 'test-refresh-token-secret-that-is-at-least-32-characters',
      secureCookies: false,
    },
  });
}
