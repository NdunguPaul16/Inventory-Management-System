import { createApp } from './app.js';
import { appInfo } from './config/app-info.js';
import { connectDbWithRetry, disconnectDb } from './config/db.js';
import { EnvValidationError, loadEnvFile, parseEnv } from './config/env.js';
import { createLogger } from './config/logger.js';

async function main(): Promise<void> {
  loadEnvFile();
  const env = parseEnv(process.env);
  const logger = createLogger(env);

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

  const app = createApp({ logger, environment: env.NODE_ENV, corsOrigins: env.CORS_ORIGINS });
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
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    server.close();
    await disconnectDb().catch((err: unknown) => logger.error({ err }, 'DB disconnect failed'));
    await stopInMemoryDb?.();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid env), so fall back to stderr.
  const message = err instanceof EnvValidationError ? err.message : err;
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
