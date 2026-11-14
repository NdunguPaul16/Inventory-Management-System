import { createApp } from './app.js';
import type { RequestHandler } from 'express';
import { appInfo } from './config/app-info.js';
import { connectDbWithRetry, disconnectDb } from './config/db.js';
import { EnvValidationError, loadEnvFile, parseEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { migrateLegacyAuditLog } from './modules/audit/migrate.js';
import { seedDefaultRoles } from './modules/roles/service.js';
import { loginRateLimiter, MemoryRateLimitStore } from './modules/auth/rate-limit.js';
import { createRedisRateLimitStore } from './modules/auth/redis-rate-limit-store.js';
import type { Logger } from './config/logger.js';
import type { AuthConfig } from './modules/auth/service.js';

export interface EarlyRoutesContext {
  logger: Logger;
  auth: AuthConfig;
  source: NodeJS.ProcessEnv;
}

async function main(
  createEarlyRoutes?: (context: EarlyRoutesContext) => RequestHandler,
): Promise<void> {
  loadEnvFile();
  const env = parseEnv(process.env);
  const logger = createLogger(env);
  let redisStore: ReturnType<typeof createRedisRateLimitStore> | undefined;
  if (env.AUTH_RATE_LIMIT_REDIS_URL) {
    try {
      redisStore = createRedisRateLimitStore(env.AUTH_RATE_LIMIT_REDIS_URL, logger);
      await redisStore.connect();
    } catch {
      await redisStore?.close();
      throw new Error('Authentication rate-limit store connection failed');
    }
  }
  const loginLimiter = loginRateLimiter({
    store: redisStore ?? new MemoryRateLimitStore(),
    keySecret: env.AUTH_ACCESS_TOKEN_SECRET,
    policy: {
      perIpMinute: env.AUTH_LOGIN_LIMIT_PER_IP_MINUTE,
      perIpHour: env.AUTH_LOGIN_LIMIT_PER_IP_HOUR,
      perAccountFifteenMinutes: env.AUTH_LOGIN_LIMIT_PER_ACCOUNT_15_MIN,
    },
  });

  let mongoUri = env.MONGODB_URI;
  let stopInMemoryDb: (() => Promise<unknown>) | undefined;
  if (!mongoUri) {
    // Only reachable in development/test: production requires MONGODB_URI (see env.ts).
    logger.warn(
      'MONGODB_URI is not set: starting an in-memory replica set. Data will NOT persist.',
    );
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoUri = replSet.getUri();
    stopInMemoryDb = () => replSet.stop();
  }

  const auth: AuthConfig = {
    accessTokenSecret: env.AUTH_ACCESS_TOKEN_SECRET,
    refreshTokenSecret: env.AUTH_REFRESH_TOKEN_SECRET,
    secureCookies: env.NODE_ENV === 'production',
  };
  const app = createApp({
    logger,
    environment: env.NODE_ENV,
    corsOrigins: env.CORS_ORIGINS,
    trustedProxyCidrs: env.AUTH_TRUSTED_PROXY_CIDRS,
    earlyRoutes: createEarlyRoutes?.({ logger, auth, source: process.env }),
    loginLimiter,
    rateLimitReady: () => redisStore?.isReady() ?? true,
    auth,
  });
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, version: appInfo.version },
      `API listening on http://localhost:${env.PORT}/api/v1`,
    );
  });

  // Connect in the background so /health can report the DB as down instead of the API crashing.
  void connectDbWithRetry(mongoUri, {
    dbName: env.MONGODB_DB_NAME,
    autoIndex: env.NODE_ENV !== 'production',
    logger,
  })
    .then(async () => {
      await migrateLegacyAuditLog();
      await seedDefaultRoles();
    })
    .catch((err: unknown) => logger.error({ err }, 'Identity bootstrap failed'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDb().catch((err: unknown) => logger.error({ err }, 'DB disconnect failed'));
    await redisStore?.close();
    await stopInMemoryDb?.();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export function runServer(
  createEarlyRoutes?: (context: EarlyRoutesContext) => RequestHandler,
): void {
  main(createEarlyRoutes).catch((err: unknown) => {
    // The logger may not exist yet (e.g. invalid env), so fall back to stderr.
    const message = err instanceof EnvValidationError ? err.message : err;
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  });
}
