import { pino } from 'pino';
import { createApp } from '../src/app.js';

export const silentLogger = pino({ level: 'silent' });

export function createTestApp() {
  return createApp({
    logger: silentLogger,
    environment: 'test',
    corsOrigins: ['http://localhost:5173'],
  });
}
