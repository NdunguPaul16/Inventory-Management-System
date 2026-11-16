import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Env } from './env.js';

export type { Logger };

/** Structured JSON logs (spec §18), pretty-printed in development. */
export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: 'ims-server' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-ims-staging-login-assertion',
        'req.headers.forwarded',
        'req.headers.x-forwarded-for',
        'req.headers.x-real-ip',
        'req.headers.x-vercel-forwarded-for',
        'req.headers.cf-connecting-ip',
        'req.remoteAddress',
        'req.remotePort',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
  };
  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
    };
  }
  return destination ? pino(options, destination) : pino(options);
}
