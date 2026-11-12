import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertStagingIsolation } from '../src/config/staging-isolation.js';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://staging-user:staging-password@stage.example.mongodb.net/',
  MONGODB_DB_NAME: 'ims_staging',
  STAGING_ATLAS_HOST: 'stage.example.mongodb.net',
  PRODUCTION_ATLAS_HOST: 'production.example.mongodb.net',
  AUTH_RATE_LIMIT_REDIS_URL: 'redis://:redis-password@stage-kv.internal:6379',
  STAGING_KEY_VALUE_HOST: 'stage-kv.internal',
  AUTH_ACCESS_TOKEN_SECRET: 'staging-access-token-secret-at-least-32-characters',
  AUTH_REFRESH_TOKEN_SECRET: 'staging-refresh-token-secret-at-least-32-characters',
};

describe('staging administrator bootstrap', () => {
  it.each([
    [{ MONGODB_DB_NAME: 'ims' }, /database name must be ims_staging/],
    [
      { MONGODB_URI: 'mongodb+srv://private@production.example.mongodb.net/' },
      /does not match STAGING_ATLAS_HOST/,
    ],
    [{ STAGING_ATLAS_HOST: 'production.example.mongodb.net' }, /hosts must differ/],
    [{ STAGING_ATLAS_HOST: '' }, /STAGING_ATLAS_HOST is required/],
    [
      { AUTH_RATE_LIMIT_REDIS_URL: 'redis://production-kv.internal:6379' },
      /does not match STAGING_KEY_VALUE_HOST/,
    ],
    [{ NODE_ENV: 'development' }, /requires production runtime mode/],
  ])('refuses unsafe configuration before prompting or connecting %#', (changes, message) => {
    expect(() => assertStagingIsolation({ ...valid, ...changes })).toThrow(message);
  });

  it('invokes the isolation guard before prompting or connecting', () => {
    const cli = readFileSync(new URL('../src/cli/bootstrap-admin.ts', import.meta.url), 'utf8');
    const guard = cli.indexOf('assertStagingIsolation(process.env)');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(cli.indexOf('await promptCredentials()'));
    expect(guard).toBeLessThan(cli.indexOf('await connectDb('));
  });

  it('runs the same preflight in the npm staging bootstrap command', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['bootstrap:admin']).toBe(
      'node dist/cli/check-staging-env.js && node dist/cli/bootstrap-admin.js',
    );
  });
});
