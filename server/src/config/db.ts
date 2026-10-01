import mongoose from 'mongoose';
import type { Health } from '@ims/shared';
import type { Logger } from './logger.js';

mongoose.set('strictQuery', true);

export interface ConnectOptions {
  dbName: string;
  autoIndex?: boolean;
}

export async function connectDb(uri: string, options: ConnectOptions): Promise<typeof mongoose> {
  return mongoose.connect(uri, {
    dbName: options.dbName,
    autoIndex: options.autoIndex ?? true,
    serverSelectionTimeoutMS: 10_000,
  });
}

/** Keeps trying to connect, with exponential backoff, so the API can start while the DB is down. */
export async function connectDbWithRetry(
  uri: string,
  options: ConnectOptions & { logger: Logger; maxDelayMs?: number },
): Promise<void> {
  const maxDelay = options.maxDelayMs ?? 30_000;
  for (let attempt = 1, delay = 1_000; ; attempt++, delay = Math.min(delay * 2, maxDelay)) {
    try {
      await connectDb(uri, options);
      options.logger.info({ dbName: options.dbName }, 'MongoDB connected');
      return;
    } catch (err) {
      options.logger.error({ err, attempt, retryInMs: delay }, 'MongoDB connection failed');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

const STATE_NAMES: Record<number, Health['db']['state']> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/** Reports the connection state and the round-trip latency of a `ping`. */
export async function getDbHealth(timeoutMs = 2_000): Promise<Health['db']> {
  const state = STATE_NAMES[mongoose.connection.readyState] ?? 'unknown';
  const db = mongoose.connection.db;
  if (state !== 'connected' || !db) return { status: 'down', state, latencyMs: null };

  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.admin().ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMs);
      }),
    ]);
    return { status: 'up', state, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: 'down', state, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}
