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
});
