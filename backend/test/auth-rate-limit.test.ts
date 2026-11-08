import * as argon2 from 'argon2';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Role } from '../src/modules/roles/model.js';
import { seedDefaultRoles } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { PASSWORD_HASH_OPTIONS } from '../src/modules/users/service.js';
import {
  loginRateLimiter,
  MemoryRateLimitStore,
  type LoginRatePolicy,
  type RateLimitStore,
} from '../src/modules/auth/rate-limit.js';
import { silentLogger } from './helpers.js';

const url = '/api/v1/auth/login';
const keySecret = 'test-rate-limit-key-that-is-at-least-32-characters';
const defaultPolicy: LoginRatePolicy = {
  perIpMinute: 10,
  perIpHour: 60,
  perAccountFifteenMinutes: 5,
};

function limitedApp(
  options: {
    store?: RateLimitStore;
    policy?: Partial<LoginRatePolicy>;
    trustedProxyCidrs?: string[];
  } = {},
) {
  return createApp({
    logger: silentLogger,
    environment: 'production',
    corsOrigins: [],
    trustedProxyCidrs: options.trustedProxyCidrs ?? [],
    loginLimiter: loginRateLimiter({
      store: options.store ?? new MemoryRateLimitStore(),
      keySecret,
      policy: { ...defaultPolicy, ...options.policy },
    }),
    rateLimitReady: () => options.store?.isReady() ?? true,
    auth: {
      accessTokenSecret: 'test-access-token-secret-that-is-at-least-32-characters',
      refreshTokenSecret: 'test-refresh-token-secret-that-is-at-least-32-characters',
      secureCookies: true,
    },
  });
}

function attempt(app: ReturnType<typeof limitedApp>, email: string, forwarded?: string) {
  const call = request(app).post(url).send({ email, password: 'incorrect-password' });
  return forwarded ? call.set('X-Forwarded-For', forwarded) : call;
}

describe('login admission control', () => {
  it('ignores spoofed forwarded addresses when no proxy is trusted', async () => {
    const app = limitedApp({ policy: { perIpMinute: 1 } });
    await attempt(app, 'first@example.test', '203.0.113.1').expect(401);
    const denied = await attempt(app, 'second@example.test', '198.51.100.2').expect(429);
    expect(denied.body.error.code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('uses the nearest untrusted proxy address and ignores a spoofed leftmost hop', async () => {
    const app = limitedApp({
      trustedProxyCidrs: ['loopback'],
      policy: { perIpMinute: 1 },
    });
    await attempt(app, 'first@example.test', '198.51.100.1, 203.0.113.8').expect(401);
    await attempt(app, 'second@example.test', '198.51.100.2, 203.0.113.8').expect(429);
    await attempt(app, 'third@example.test', '198.51.100.2, 203.0.113.9').expect(401);
  });

  it('uses one bucket for equivalent IPv6 client spellings', async () => {
    const app = limitedApp({ trustedProxyCidrs: ['loopback'], policy: { perIpMinute: 1 } });
    await attempt(app, 'first@example.test', '2001:db8::1').expect(401);
    await attempt(app, 'second@example.test', '2001:0db8:0:0:0:0:0:1').expect(429);
  });

  it('shares an IP budget across different accounts on one network', async () => {
    const app = limitedApp({ policy: { perIpMinute: 2 } });
    await attempt(app, 'first@example.test').expect(401);
    await attempt(app, 'second@example.test').expect(401);
    const auditCount = await AuditLog.countDocuments({ action: 'auth.login.failed' });
    await attempt(app, 'third@example.test').expect(429);
    expect(await AuditLog.countDocuments({ action: 'auth.login.failed' })).toBe(auditCount);
  });

  it('shares an account budget across multiple client addresses', async () => {
    const app = limitedApp({
      trustedProxyCidrs: ['loopback'],
      policy: { perAccountFifteenMinutes: 2 },
    });
    await attempt(app, 'target@example.test', '203.0.113.1').expect(401);
    await attempt(app, 'target@example.test', '203.0.113.2').expect(401);
    await attempt(app, 'target@example.test', '203.0.113.3').expect(429);
  });

  it('shares counters between app instances using one store', async () => {
    const store = new MemoryRateLimitStore();
    const firstApp = limitedApp({ store, policy: { perIpMinute: 1 } });
    const secondApp = limitedApp({ store, policy: { perIpMinute: 1 } });
    await attempt(firstApp, 'first@example.test').expect(401);
    await attempt(secondApp, 'second@example.test').expect(429);
  });

  it('preserves successful login, refresh and logout with the limiter enabled', async () => {
    await seedDefaultRoles();
    const role = await Role.findOne({ name: 'Admin' });
    if (!role) throw new Error('Admin role was not seeded');
    const email = 'limited-admin@example.test';
    const password = 'Correct horse battery staple 2026';
    await User.create({
      name: 'Limited Admin',
      email,
      passwordHash: await argon2.hash(password, PASSWORD_HASH_OPTIONS),
      roleIds: [role._id],
    });
    const app = limitedApp();
    const login = await request(app).post(url).send({ email, password }).expect(200);
    expect(login.body.data.user.permissions).toContain('*');
    const cookie = login.headers['set-cookie'];
    if (!cookie) throw new Error('Login did not set a refresh cookie');
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);
    expect(refresh.body.data.accessToken).toEqual(expect.any(String));
    if (!refresh.headers['set-cookie']) throw new Error('Refresh did not rotate the cookie');
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', refresh.headers['set-cookie'])
      .expect(204);
  });

  it('fails closed without touching authentication or audit when the store is unavailable', async () => {
    const app = limitedApp({
      store: {
        isReady: () => false,
        consume: async () => {
          throw new Error('simulated store outage with secret data');
        },
      },
    });
    const auditCount = await AuditLog.countDocuments();
    const denied = await attempt(app, 'unavailable@example.test').expect(503);
    expect(denied.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' },
    });
    expect(JSON.stringify(denied.body)).not.toContain('simulated store outage');
    expect(await AuditLog.countDocuments()).toBe(auditCount);
    const health = await request(app).get('/api/v1/health').expect(503);
    expect(health.body.data.authRateLimit).toEqual({ status: 'down' });
  });

  it('rejects malformed login bodies before using a rate-limit slot', async () => {
    const app = limitedApp({ policy: { perIpMinute: 1 } });
    await request(app).post(url).send({ email: 'bad', password: 'x' }).expect(400);
    await attempt(app, 'valid@example.test').expect(401);
  });
});
