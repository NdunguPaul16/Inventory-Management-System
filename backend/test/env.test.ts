import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      MONGODB_DB_NAME: 'ims',
      CORS_ORIGINS: ['http://localhost:5173'],
      AUTH_TRUSTED_PROXY_CIDRS: [],
      AUTH_LOGIN_LIMIT_PER_IP_MINUTE: 10,
    });
    expect(env.MONGODB_URI).toBeUndefined();
  });

  it('coerces and splits values', () => {
    const env = parseEnv({
      PORT: '5000',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net',
      CORS_ORIGINS: 'http://a.test, http://b.test ,',
    });
    expect(env.PORT).toBe(5000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('treats an empty MONGODB_URI as unset', () => {
    expect(parseEnv({ MONGODB_URI: '  ' }).MONGODB_URI).toBeUndefined();
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => parseEnv({ PORT: 'abc', MONGODB_URI: 'http://nope' })).toThrow(EnvValidationError);
    try {
      parseEnv({ PORT: 'abc', MONGODB_URI: 'http://nope' });
    } catch (err) {
      expect((err as EnvValidationError).issues.join('\n')).toMatch(/PORT[\s\S]*MONGODB_URI/);
    }
  });

  it('requires MONGODB_URI in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/MONGODB_URI is required/);
  });

  it('requires a shared rate-limit store in production', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost:27017/test',
        AUTH_ACCESS_TOKEN_SECRET: 'production-access-token-secret-at-least-32-characters',
        AUTH_REFRESH_TOKEN_SECRET: 'production-refresh-token-secret-at-least-32-characters',
      }),
    ).toThrow(/AUTH_RATE_LIMIT_REDIS_URL is required/);
  });

  it('accepts explicit proxy ranges and rejects malformed ranges or limits', () => {
    const env = parseEnv({
      AUTH_TRUSTED_PROXY_CIDRS: 'loopback, 203.0.113.0/24, 2001:db8::/32',
      AUTH_LOGIN_LIMIT_PER_IP_MINUTE: '20',
    });
    expect(env.AUTH_TRUSTED_PROXY_CIDRS).toEqual(['loopback', '203.0.113.0/24', '2001:db8::/32']);
    expect(env.AUTH_LOGIN_LIMIT_PER_IP_MINUTE).toBe(20);
    expect(() => parseEnv({ AUTH_TRUSTED_PROXY_CIDRS: 'anywhere' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ AUTH_TRUSTED_PROXY_CIDRS: '203.0.113.0/40' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ AUTH_LOGIN_LIMIT_PER_IP_MINUTE: '0' })).toThrow(EnvValidationError);
  });
});
