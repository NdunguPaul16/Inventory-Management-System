import { describe, expect, it } from 'vitest';
import { assertStagingIsolation } from '../src/config/staging-isolation.js';

const valid = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://staging-user:private@stage.example.mongodb.net/?retryWrites=true',
  MONGODB_DB_NAME: 'ims_staging',
  STAGING_ATLAS_HOST: 'stage.example.mongodb.net',
  PRODUCTION_ATLAS_HOST: 'production.example.mongodb.net',
  AUTH_RATE_LIMIT_REDIS_URL: 'redis://:private@stage-kv.internal:6379',
  STAGING_KEY_VALUE_HOST: 'stage-kv.internal',
  AUTH_ACCESS_TOKEN_SECRET: 'staging-access-token-secret-at-least-32-characters',
  AUTH_REFRESH_TOKEN_SECRET: 'staging-refresh-token-secret-at-least-32-characters',
};

describe('staging isolation preflight', () => {
  it('accepts separately pinned staging Atlas and Key Value hosts', () => {
    expect(() => assertStagingIsolation(valid)).not.toThrow();
  });

  it.each([
    [{ MONGODB_DB_NAME: 'ims' }, /database name/],
    [
      { MONGODB_URI: 'mongodb+srv://private@production.example.mongodb.net/' },
      /STAGING_ATLAS_HOST/,
    ],
    [{ STAGING_ATLAS_HOST: 'production.example.mongodb.net' }, /hosts must differ/],
    [{ STAGING_ATLAS_HOST: '' }, /STAGING_ATLAS_HOST is required/],
    [
      { AUTH_RATE_LIMIT_REDIS_URL: 'redis://production-kv.internal:6379' },
      /STAGING_KEY_VALUE_HOST/,
    ],
    [{ STAGING_KEY_VALUE_HOST: '' }, /STAGING_KEY_VALUE_HOST is required/],
    [{ MONGODB_URI: 'mongodb://stage.example.mongodb.net' }, /connection URL is invalid/],
  ])('rejects unsafe staging configuration %#', (changes, message) => {
    expect(() => assertStagingIsolation({ ...valid, ...changes })).toThrow(message);
  });

  it('does not disclose connection credentials in validation errors', () => {
    try {
      assertStagingIsolation({ ...valid, STAGING_ATLAS_HOST: 'wrong.example.mongodb.net' });
    } catch (error) {
      expect(String(error)).not.toContain('private');
      return;
    }
    throw new Error('Expected staging validation to reject a host mismatch');
  });
});
