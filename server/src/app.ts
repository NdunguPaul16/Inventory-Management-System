import { randomUUID } from 'node:crypto';
import express, { Router, type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from './config/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';

export interface AppOptions {
  logger: Logger;
  environment: 'development' | 'test' | 'production';
  corsOrigins: string[];
}

const REQUEST_ID_HEADER = 'x-request-id';

export function createApp(options: AppOptions): Express {
  const app = express();

  // Logging goes first so every later middleware (and the error handler) has req.log.
  app.use(
    pinoHttp({
      logger: options.logger,
      // Every log line carries a request id (spec §18); a valid incoming id is reused.
      genReqId: (req, res) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id =
          typeof incoming === 'string' && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  // TODO(phase-10): set `trust proxy` once the production hosting is chosen.
  app.use(helmet());
  app.use(cors({ origin: options.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  const api = Router();
  api.use('/health', healthRoutes(options.environment));
  // TODO(phase-1): auth, users/roles, settings and master data routes, each behind requirePermission().
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeInternalErrors: options.environment !== 'production' }));
  return app;
}
