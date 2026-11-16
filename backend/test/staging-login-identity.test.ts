import { createHash, createHmac } from 'node:crypto';
import * as argon2 from 'argon2';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { handleStagingLogin } from '../../frontend/staging-login-gateway/function.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/config/logger.js';
import {
  loginRateLimiter,
  type RateBucket,
  type RateLimitStore,
} from '../src/modules/auth/rate-limit.js';
import { Role } from '../src/modules/roles/model.js';
import { seedDefaultRoles } from '../src/modules/roles/service.js';
import { createStagingLoginIdentity } from '../src/staging/login-identity.js';
import { User } from '../src/modules/users/model.js';
import { PASSWORD_HASH_OPTIONS } from '../src/modules/users/service.js';
import { silentLogger } from './helpers.js';

const key = 'a'.repeat(64);
const secondKey = 'b'.repeat(64);
const source = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://stage.example.test/',
  MONGODB_DB_NAME: 'ims_staging',
  AUTH_RATE_LIMIT_REDIS_URL: 'redis://stage-kv.internal:6379',
  AUTH_ACCESS_TOKEN_SECRET: 'staging-access-secret-at-least-32-characters',
  AUTH_REFRESH_TOKEN_SECRET: 'staging-refresh-secret-at-least-32-characters',
  STAGING_ATLAS_HOST: 'stage.example.test',
  PRODUCTION_ATLAS_HOST: 'production.example.test',
  STAGING_KEY_VALUE_HOST: 'stage-kv.internal',
  STAGING_LOGIN_GATEWAY_KEY_CURRENT: key,
};
const path = '/api/v1/auth/login';
const body = { email: 'test@example.test', password: 'valid-password' };

function assertion(
  options: {
    identity?: string;
    nonce?: string;
    time?: number;
    path?: string;
    method?: string;
    key?: string;
    password?: string;
  } = {},
) {
  const timestamp = String(options.time ?? 1_800_000_000_000);
  const nonce = options.nonce ?? '1'.repeat(32);
  const identity = options.identity ?? '2'.repeat(64);
  const bodyHash = createHash('sha256')
    .update(JSON.stringify({ ...body, password: options.password ?? body.password }))
    .digest('hex');
  const signed = [
    'ims-login-v1',
    options.method ?? 'POST',
    options.path ?? path,
    timestamp,
    nonce,
    identity,
    bodyHash,
  ].join('\n');
  const signature = createHmac('sha256', Buffer.from(options.key ?? key, 'hex'))
    .update(signed)
    .digest('hex');
  return `v1.${timestamp}.${nonce}.${identity}.${signature}`;
}

function fixture(
  config: {
    current?: string;
    previous?: string;
    storeUnavailable?: boolean;
    observeHeaders?: (headers: Record<string, unknown>) => void;
    logLines?: string[];
  } = {},
) {
  const seen: RateBucket[][] = [];
  const claimed = new Set<string>();
  const store: RateLimitStore = {
    isReady: () => !config.storeUnavailable,
    consume: async (buckets) => {
      if (config.storeUnavailable) throw new Error('secret connection detail');
      seen.push([...buckets]);
      if (buckets.length === 1) {
        const nonceKey = buckets[0]?.key;
        if (!nonceKey) throw new Error('Missing nonce key');
        if (claimed.has(nonceKey)) return { allowed: false, retryAfterSeconds: 1 };
        claimed.add(nonceKey);
        return { allowed: true, retryAfterSeconds: 0 };
      }
      return { allowed: false, retryAfterSeconds: 3 };
    },
  };
  const ingress = createStagingLoginIdentity({
    source: {
      ...source,
      STAGING_LOGIN_GATEWAY_KEY_CURRENT: config.current ?? key,
      STAGING_LOGIN_GATEWAY_KEY_PREVIOUS: config.previous,
    },
    store,
    now: () => 1_800_000_000_000,
  });
  const earlyRoutes = Router();
  earlyRoutes.use(ingress.capture);
  earlyRoutes.use((req, _res, next) => {
    config.observeHeaders?.(req.headers);
    next();
  });
  const app = createApp({
    logger: config.logLines
      ? createLogger(
          { NODE_ENV: 'production', LOG_LEVEL: 'info' },
          {
            write: (line) => config.logLines?.push(line),
          },
        )
      : silentLogger,
    environment: 'production',
    corsOrigins: [],
    trustedProxyCidrs: [],
    earlyRoutes,
    loginAdmission: ingress.admit,
    loginLimiter: loginRateLimiter({
      store,
      keySecret: 'test-limiter-secret-at-least-32-characters',
      policy: { perIpMinute: 10, perIpHour: 60, perAccountFifteenMinutes: 5 },
      clientIdentity: ingress.clientIdentity,
    }),
    rateLimitReady: store.isReady,
    auth: {
      accessTokenSecret: 'test-access-secret-at-least-32-characters',
      refreshTokenSecret: 'test-refresh-secret-at-least-32-characters',
      secureCookies: true,
    },
  });
  const post = (token?: string, forwarded?: string) => {
    const call = request(app).post(path).send(body);
    if (token) call.set('x-ims-staging-login-assertion', token);
    if (forwarded) call.set('X-Forwarded-For', forwarded);
    return call;
  };
  return { app, seen, post };
}

describe('staging signed login admission', () => {
  it('rejects unsigned direct Render logins before consuming a limiter bucket', async () => {
    const { post, seen } = fixture();
    await post().expect(403);
    expect(seen).toHaveLength(0);
  });

  it('uses distinct per-IP keys for distinct verified identities and stable keys for repeats', async () => {
    const { post, seen } = fixture();
    await post(assertion({ nonce: '1'.repeat(32), identity: '2'.repeat(64) })).expect(429);
    await post(assertion({ nonce: '3'.repeat(32), identity: '4'.repeat(64) })).expect(429);
    await post(assertion({ nonce: '5'.repeat(32), identity: '2'.repeat(64) })).expect(429);
    const limiter = seen.filter((entry) => entry.length === 3);
    expect(limiter).toHaveLength(3);
    expect(limiter[0]?.[0]?.key).not.toBe(limiter[1]?.[0]?.key);
    expect(limiter[0]?.[0]?.key).toBe(limiter[2]?.[0]?.key);
    expect(limiter[0]?.[2]?.key).toBe(limiter[1]?.[2]?.key);
  });

  it('ignores forged forwarding headers when selecting the verified identity', async () => {
    const { post, seen } = fixture();
    await post(assertion({ nonce: '1'.repeat(32) }), '203.0.113.1').expect(429);
    await post(assertion({ nonce: '2'.repeat(32) }), '198.51.100.2').expect(429);
    const limiter = seen.filter((entry) => entry.length === 3);
    expect(limiter[0]?.[0]?.key).toBe(limiter[1]?.[0]?.key);
  });

  it.each([
    ['bad signature', assertion().replace(/.$/, (last) => (last === '0' ? '1' : '0'))],
    ['expired', assertion({ time: 1_799_999_969_999 })],
    ['future', assertion({ time: 1_800_000_005_001 })],
    ['wrong path', assertion({ path: '/api/v1/auth/refresh' })],
    ['wrong method', assertion({ method: 'GET' })],
    ['wrong body', assertion({ password: 'different-password' })],
  ])('rejects %s', async (_name, value) => {
    const { post, seen } = fixture();
    await post(value).expect(403);
    expect(seen).toHaveLength(0);
  });

  it('rejects replay before the login limiter', async () => {
    const { post, seen } = fixture();
    const value = assertion();
    await post(value).expect(429);
    await post(value).expect(403);
    expect(seen.filter((entry) => entry.length === 3)).toHaveLength(1);
  });

  it('retains replay protection for an old key across key rotation', async () => {
    const { post, seen } = fixture({ current: secondKey, previous: key });
    const value = assertion();
    await post(value).expect(429);
    await post(value).expect(403);
    expect(seen.filter((entry) => entry.length === 3)).toHaveLength(1);
  });

  it('fails closed with a sanitized 503 when the shared replay store fails', async () => {
    const { post } = fixture({ storeUnavailable: true });
    const response = await post(assertion()).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('secret connection detail');
  });

  it('accepts a Vercel Function assertion without any live request', async () => {
    const { app } = fixture();
    const upstream: typeof fetch = async (_url, init) => {
      const assertionValue = new Headers(init?.headers).get('x-ims-staging-login-assertion');
      if (!assertionValue) throw new Error('Missing signed assertion');
      const response = await request(app)
        .post(path)
        .set('x-ims-staging-login-assertion', assertionValue)
        .send(JSON.parse(String(init?.body)));
      return Response.json(response.body, { status: response.status });
    };
    const response = await handleStagingLogin(
      new Request(`https://preview.example.test${path}`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.1' },
        body: JSON.stringify(body),
      }),
      {
        source: {
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: 'staging/security-audit',
          STAGING_LOGIN_GATEWAY_KEY_CURRENT: key,
        },
        fetcher: upstream,
        now: () => 1_800_000_000_000,
        nonce: () => '9'.repeat(32),
      },
    );
    expect(response.status).toBe(429);
  });

  it('refuses missing signing configuration at startup', () => {
    expect(() =>
      createStagingLoginIdentity({
        source: { ...source, STAGING_LOGIN_GATEWAY_KEY_CURRENT: undefined },
        store: {
          isReady: () => true,
          consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        },
      }),
    ).toThrow('Staging login identity configuration is invalid');
  });

  it('preserves successful login, refresh cookie rotation and logout', async () => {
    await seedDefaultRoles();
    const role = await Role.findOne({ name: 'Admin' });
    if (!role) throw new Error('Missing test Admin role');
    await User.create({
      name: 'Gateway Admin',
      email: body.email,
      passwordHash: await argon2.hash(body.password, PASSWORD_HASH_OPTIONS),
      roleIds: [role._id],
    });
    const store = new (await import('../src/modules/auth/rate-limit.js')).MemoryRateLimitStore();
    const ingress = createStagingLoginIdentity({ source, store, now: () => 1_800_000_000_000 });
    const app = createApp({
      logger: silentLogger,
      environment: 'production',
      corsOrigins: [],
      trustedProxyCidrs: [],
      earlyRoutes: ingress.capture,
      loginAdmission: ingress.admit,
      loginLimiter: loginRateLimiter({
        store,
        keySecret: 'test-limiter-secret-at-least-32-characters',
        policy: { perIpMinute: 10, perIpHour: 60, perAccountFifteenMinutes: 5 },
        clientIdentity: ingress.clientIdentity,
      }),
      rateLimitReady: store.isReady,
      auth: {
        accessTokenSecret: 'test-access-secret-at-least-32-characters',
        refreshTokenSecret: 'test-refresh-secret-at-least-32-characters',
        secureCookies: true,
      },
    });
    const login = await request(app)
      .post(path)
      .set('x-ims-staging-login-assertion', assertion())
      .send(body)
      .expect(200);
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    const cookie = login.headers['set-cookie'];
    if (!cookie) throw new Error('Login did not return a refresh cookie');
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);
    expect(refresh.body.data.accessToken).toEqual(expect.any(String));
    const rotatedCookie = refresh.headers['set-cookie'];
    if (!rotatedCookie) throw new Error('Refresh did not rotate the cookie');
    await request(app)
      .post(path)
      .set('x-ims-staging-login-assertion', assertion({ nonce: '2'.repeat(32), password: 'wrong' }))
      .send({ ...body, password: 'wrong' })
      .expect(401);
    await request(app).post('/api/v1/auth/logout').set('Cookie', rotatedCookie).expect(204);
  });

  it('strips signed and sensitive forwarding headers before normal request logging', async () => {
    let observed: Record<string, unknown> | undefined;
    const { app } = fixture({ observeHeaders: (headers) => (observed = { ...headers }) });
    await request(app)
      .post(path)
      .set('x-ims-staging-login-assertion', assertion())
      .set('X-Forwarded-For', '203.0.113.1')
      .set('CF-Connecting-IP', '203.0.113.1')
      .set('Authorization', 'Bearer should-not-be-logged')
      .set('Cookie', 'secret=cookie')
      .send(body)
      .expect(429);
    expect(observed).toBeDefined();
    for (const name of [
      'x-ims-staging-login-assertion',
      'x-forwarded-for',
      'cf-connecting-ip',
      'authorization',
      'cookie',
    ]) {
      expect(observed).not.toHaveProperty(name);
    }
  });

  it.each([
    ['exact signed login', path, true, 429],
    ['trailing-slash login', `${path}/`, true, 403],
    ['case-variant login', '/API/v1/AUTH/LOGIN', true, 403],
    ['unsigned login', path, false, 403],
    ['invalid assertion', path, true, 403],
  ])('keeps private headers out of actual logs for %s', async (_name, route, signed, status) => {
    const logLines: string[] = [];
    const { app } = fixture({ logLines });
    const token = signed
      ? status === 429
        ? assertion({ password: 'fixture-password-in-body' })
        : 'invalid-fixture-assertion'
      : undefined;
    let call = request(app)
      .post(route)
      .set('X-Forwarded-For', '203.0.113.41')
      .set('X-Real-IP', '198.51.100.42')
      .set('Forwarded', 'for=192.0.2.43')
      .set('X-Vercel-Forwarded-For', '192.0.2.44')
      .set('CF-Connecting-IP', '192.0.2.45')
      .set('Authorization', 'Bearer fixture-authorization')
      .set('Cookie', 'session=fixture-cookie');
    if (token) call = call.set('x-ims-staging-login-assertion', token);
    await call.send({ ...body, password: 'fixture-password-in-body' }).expect(status);
    const output = logLines.join('');
    if (route !== path) expect(logLines).toHaveLength(0);
    else if (signed) expect(logLines.length).toBeGreaterThan(0);
    for (const secret of [
      token,
      '203.0.113.41',
      '198.51.100.42',
      '192.0.2.43',
      '192.0.2.44',
      '192.0.2.45',
      'fixture-authorization',
      'fixture-cookie',
      'fixture-password-in-body',
      key,
    ]) {
      if (secret) expect(output).not.toContain(secret);
    }
  });

  it('redacts private headers even when a rejected path never enters the login scrubber', async () => {
    const logLines: string[] = [];
    const { app } = fixture({ logLines });
    await request(app)
      .get('/api/v1/unknown')
      .set('x-ims-staging-login-assertion', 'fixture-unmatched-assertion')
      .set('X-Forwarded-For', '203.0.113.46')
      .expect(404);
    const output = logLines.join('');
    expect(logLines.length).toBeGreaterThan(0);
    expect(output).not.toContain('fixture-unmatched-assertion');
    expect(output).not.toContain('203.0.113.46');
    const loggedRequest = JSON.parse(logLines[0]!) as {
      req?: { remoteAddress?: string; remotePort?: string };
    };
    expect(loggedRequest.req?.remoteAddress).toBe('[redacted]');
    expect(loggedRequest.req?.remotePort).toBe('[redacted]');
  });
});
