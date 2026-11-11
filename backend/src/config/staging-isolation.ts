import { parseEnv } from './env.js';

function hostname(uri: string, protocol: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol !== protocol || !url.hostname) throw new Error('Invalid URI');
    return url.hostname.toLowerCase();
  } catch {
    throw new Error('Staging connection URL is invalid');
  }
}

function expectedHost(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim().toLowerCase();
  if (!value || !/^[a-z0-9.-]+$/.test(value)) throw new Error(`${name} is required`);
  return value;
}

/** Refuse to start the staging service unless its Atlas and Key Value hosts are pinned. */
export function assertStagingIsolation(source: NodeJS.ProcessEnv): void {
  const env = parseEnv(source);
  if (env.NODE_ENV !== 'production') throw new Error('Staging requires production runtime mode');
  if (env.MONGODB_DB_NAME !== 'ims_staging')
    throw new Error('Staging database name must be ims_staging');
  if (!env.MONGODB_URI || !env.AUTH_RATE_LIMIT_REDIS_URL) {
    throw new Error('Staging database and Key Value URLs are required');
  }

  const stagingAtlas = expectedHost(source, 'STAGING_ATLAS_HOST');
  const productionAtlas = expectedHost(source, 'PRODUCTION_ATLAS_HOST');
  if (stagingAtlas === productionAtlas)
    throw new Error('Staging and production Atlas hosts must differ');
  if (hostname(env.MONGODB_URI, 'mongodb+srv:') !== stagingAtlas) {
    throw new Error('Staging database URL does not match STAGING_ATLAS_HOST');
  }
  const stagingKeyValue = expectedHost(source, 'STAGING_KEY_VALUE_HOST');
  const redisProtocol = env.AUTH_RATE_LIMIT_REDIS_URL.startsWith('rediss://')
    ? 'rediss:'
    : 'redis:';
  if (hostname(env.AUTH_RATE_LIMIT_REDIS_URL, redisProtocol) !== stagingKeyValue) {
    throw new Error('Staging Key Value URL does not match STAGING_KEY_VALUE_HOST');
  }
}
