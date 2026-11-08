import { randomUUID } from 'node:crypto';
import express, { Router, type Express, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from './config/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { roleRoutes } from './modules/roles/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { authenticate } from './middleware/authenticate.js';
import type { AuthConfig } from './modules/auth/service.js';

export interface AppOptions {
  logger: Logger;
  environment: 'development' | 'test' | 'production';
  corsOrigins: string[];
  auth: AuthConfig;
  loginLimiter: RequestHandler;
  rateLimitReady: () => boolean;
  trustedProxyCidrs: string[];
}

const REQUEST_ID_HEADER = 'x-request-id';

export function createApp(options: AppOptions): Express {
  const app = express();
  app.set('trust proxy', options.trustedProxyCidrs.length ? options.trustedProxyCidrs : false);

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

  app.use(helmet());
  app.use(cors({ origin: options.corsOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(authenticate(options.auth));

  const api = Router();
  api.use('/health', healthRoutes(options.environment, options.rateLimitReady));
  api.use('/auth', authRoutes(options.auth, options.loginLimiter));
  api.use('/users', userRoutes);
  api.use('/roles', roleRoutes);
  api.use('/audit-logs', auditRoutes);
  api.use('/inventory', inventoryRoutes);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeInternalErrors: options.environment !== 'production' }));
  return app;
}
