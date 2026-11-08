import { createClient } from '@redis/client';
import type { Logger } from '../../config/logger.js';
import type { RateBucket, RateDecision, RateLimitStore } from './rate-limit.js';

// Check every bucket before incrementing any of them. The single Redis script is atomic,
// and expiration never extends merely because an already-limited client keeps retrying.
const CONSUME_SCRIPT = `
local retry = 0
local denied = false
for i = 1, #KEYS do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  local limit = tonumber(ARGV[i * 2 - 1])
  if count >= limit then
    denied = true
    retry = math.max(retry, math.max(redis.call('TTL', KEYS[i]), 1))
  end
end
if denied then return {0, retry} end
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i * 2])) end
end
return {1, 0}
`;

export function createRedisRateLimitStore(
  url: string,
  logger: Logger,
): RateLimitStore & {
  connect(): Promise<void>;
  close(): Promise<void>;
} {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) =>
        retries >= 3
          ? new Error('Rate-limit store unavailable')
          : Math.min(500 * 2 ** retries, 2_000),
    },
  });
  client.on('error', () => logger.warn('Authentication rate-limit store connection error'));
  return {
    isReady: () => client.isReady,
    connect: async () => {
      await client.connect();
    },
    close: async () => {
      client.destroy();
    },
    consume: async (buckets: readonly RateBucket[]): Promise<RateDecision> => {
      if (!client.isReady) throw new Error('Authentication rate-limit store unavailable');
      const result = await client.eval(CONSUME_SCRIPT, {
        keys: buckets.map((bucket) => bucket.key),
        arguments: buckets.flatMap((bucket) => [
          String(bucket.limit),
          String(bucket.windowSeconds),
        ]),
      });
      if (!Array.isArray(result) || result.length !== 2)
        throw new Error('Invalid limiter response');
      const allowed = Number(result[0]);
      const retryAfterSeconds = Number(result[1]);
      if ((allowed !== 0 && allowed !== 1) || !Number.isFinite(retryAfterSeconds)) {
        throw new Error('Invalid limiter response');
      }
      return { allowed: allowed === 1, retryAfterSeconds: Math.max(0, retryAfterSeconds) };
    },
  };
}
