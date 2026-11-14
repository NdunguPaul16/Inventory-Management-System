import { Writable } from 'node:stream';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { pino, type Logger } from 'pino';
import request from 'supertest';
import ts from 'typescript';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { assertStagingIsolation } from '../src/config/staging-isolation.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/auth/model.js';
import { Role } from '../src/modules/roles/model.js';
import { User } from '../src/modules/users/model.js';
import {
  clientIpDiagnosticRouter,
  diagnosticErrorHandler,
} from '../src/staging/client-ip-diagnostic.js';
import { silentLogger } from './helpers.js';

const path = '/api/v1/internal/client-ip-diagnostic';
const accessSecret = 'staging-access-token-secret-at-least-32-characters';
const refreshSecret = 'staging-refresh-token-secret-at-least-32-characters';
const safeSource = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://staging-user:private@stage.example.mongodb.net/',
  MONGODB_DB_NAME: 'ims_staging',
  STAGING_ATLAS_HOST: 'stage.example.mongodb.net',
  PRODUCTION_ATLAS_HOST: 'production.example.mongodb.net',
  AUTH_RATE_LIMIT_REDIS_URL: 'redis://:private@stage-kv.internal:6379',
  STAGING_KEY_VALUE_HOST: 'stage-kv.internal',
  AUTH_ACCESS_TOKEN_SECRET: accessSecret,
  AUTH_REFRESH_TOKEN_SECRET: refreshSecret,
};

function enabledSource(changes: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...safeSource,
    STAGING_CLIENT_IP_DIAGNOSTIC_ENABLED: 'true',
    STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...changes,
  };
}

function diagnosticApp(
  options: {
    source?: NodeJS.ProcessEnv;
    trustedProxyCidrs?: string[];
    logger?: Logger;
    includeEarlyRoutes?: boolean;
  } = {},
) {
  let limiterCalls = 0;
  const auth = {
    accessTokenSecret: accessSecret,
    refreshTokenSecret: refreshSecret,
    secureCookies: true,
  };
  const logger = options.logger ?? silentLogger;
  const earlyRoutes = Router();
  earlyRoutes.use(
    path,
    clientIpDiagnosticRouter({
      source: options.source,
      logger,
      auth,
    }),
  );
  const app = createApp({
    logger,
    environment: 'production',
    corsOrigins: [],
    trustedProxyCidrs: options.trustedProxyCidrs ?? [],
    ...(options.includeEarlyRoutes === false ? {} : { earlyRoutes }),
    loginLimiter: (_req, _res, next) => {
      limiterCalls += 1;
      next();
    },
    rateLimitReady: () => true,
    auth,
  });
  return { app, limiterCalls: () => limiterCalls };
}

let adminToken: string;
let storekeeperToken: string;
let wildcardToken: string;

beforeAll(async () => {
  const [adminRole, storekeeperRole, wildcardRole] = await Role.create([
    { name: 'Admin', permissions: ['*'], isSystem: true },
    { name: 'Storekeeper', permissions: ['inventory.balances.read'], isSystem: true },
    { name: 'Custom wildcard', permissions: ['*'], isSystem: false },
  ]);
  if (!adminRole || !storekeeperRole || !wildcardRole) throw new Error('Test roles missing');
  const [admin, storekeeper, wildcard] = await User.create([
    {
      name: 'Test Admin',
      email: 'admin@example.test',
      passwordHash: 'unused',
      roleIds: [adminRole._id],
    },
    {
      name: 'Test Storekeeper',
      email: 'storekeeper@example.test',
      passwordHash: 'unused',
      roleIds: [storekeeperRole._id],
    },
    {
      name: 'Test Wildcard',
      email: 'wildcard@example.test',
      passwordHash: 'unused',
      roleIds: [wildcardRole._id],
    },
  ]);
  if (!admin || !storekeeper || !wildcard) throw new Error('Test users missing');
  const token = (id: string) =>
    jwt.sign({ type: 'access' }, accessSecret, { subject: id, expiresIn: '15m' });
  adminToken = token(String(admin._id));
  storekeeperToken = token(String(storekeeper._id));
  wildcardToken = token(String(wildcard._id));
});

function asAdmin(app: ReturnType<typeof diagnosticApp>['app']) {
  return request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
}

describe('temporary staging client-IP diagnostic', () => {
  it('keeps the staging module out of the standard backend build', () => {
    const configPath = fileURLToPath(new URL('../tsconfig.build.json', import.meta.url));
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
    expect(parsed.errors).toEqual([]);
    expect(
      parsed.fileNames.some((name) => name.replaceAll('\\', '/').includes('/src/staging/')),
    ).toBe(false);

    const stagingConfigPath = fileURLToPath(new URL('../tsconfig.staging.json', import.meta.url));
    const stagingConfig = ts.readConfigFile(stagingConfigPath, ts.sys.readFile);
    expect(stagingConfig.error).toBeUndefined();
    const stagingParsed = ts.parseJsonConfigFileContent(
      stagingConfig.config,
      ts.sys,
      dirname(stagingConfigPath),
    );
    expect(stagingParsed.errors).toEqual([]);
    expect(
      stagingParsed.fileNames.some((name) =>
        name.replaceAll('\\', '/').endsWith('/src/staging/client-ip-diagnostic.ts'),
      ),
    ).toBe(true);
  });

  it('does not mount the diagnostic in the normal app, even with misleading staging labels', async () => {
    const misleading = enabledSource({
      MONGODB_URI: 'mongodb+srv://private@actual-production.example.mongodb.net/',
      STAGING_ATLAS_HOST: 'actual-production.example.mongodb.net',
      PRODUCTION_ATLAS_HOST: 'some-other.example.mongodb.net',
    });
    expect(() => assertStagingIsolation(misleading)).not.toThrow();
    const { app } = diagnosticApp({ source: misleading, includeEarlyRoutes: false });
    await asAdmin(app).expect(404);
  });

  it('is disabled by default and accepts GET only', async () => {
    const disabled = diagnosticApp({ source: safeSource });
    const response = await asAdmin(disabled.app).expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(response.headers['cache-control']).toContain('no-store');

    const enabled = diagnosticApp({ source: enabledSource() });
    await request(enabled.app).post(path).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it.each([
    ['production database', { MONGODB_DB_NAME: 'ims' }],
    [
      'production Atlas host',
      { MONGODB_URI: 'mongodb+srv://private@production.example.mongodb.net/' },
    ],
    ['production Key Value host', { AUTH_RATE_LIMIT_REDIS_URL: 'redis://production-kv.internal' }],
    ['development mode', { NODE_ENV: 'development' }],
    ['missing expiry', { STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT: undefined }],
    ['invalid expiry', { STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT: 'not-a-date' }],
  ])('does not activate with %s', async (_label, changes) => {
    const { app } = diagnosticApp({ source: enabledSource(changes) });
    await asAdmin(app).expect(404);
  });

  it('expires independently of process restarts and rejects an excessive duration', async () => {
    const expired = diagnosticApp({
      source: enabledSource({
        STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    await asAdmin(expired.app).expect(404);
    const tooLong = diagnosticApp({
      source: enabledSource({
        STAGING_CLIENT_IP_DIAGNOSTIC_EXPIRES_AT: new Date(
          Date.now() + 25 * 60 * 60_000,
        ).toISOString(),
      }),
    });
    await asAdmin(tooLong.app).expect(404);
  });

  it('requires authentication and the seeded Admin role', async () => {
    const { app } = diagnosticApp({ source: enabledSource() });
    const anonymous = await request(app).get(path).expect(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    await request(app).get(path).set('Authorization', `Bearer ${storekeeperToken}`).expect(403);
    await request(app).get(path).set('Authorization', `Bearer ${wildcardToken}`).expect(403);
    await asAdmin(app).expect(200);
  });

  it('does not call the login limiter or change local database records', async () => {
    const diagnostic = diagnosticApp({ source: enabledSource() });
    const before = await Promise.all([
      AuditLog.countDocuments(),
      Session.countDocuments(),
      User.find().lean(),
      Role.find().lean(),
    ]);
    await asAdmin(diagnostic.app).expect(200);
    const after = await Promise.all([
      AuditLog.countDocuments(),
      Session.countDocuments(),
      User.find().lean(),
      Role.find().lean(),
    ]);
    expect(after).toEqual(before);
    expect(diagnostic.limiterCalls()).toBe(0);
  });

  it('returns temporary identifiers without raw addresses, tokens or headers', async () => {
    const { app } = diagnosticApp({ source: enabledSource() });
    const first = await asAdmin(app)
      .set('X-Forwarded-For', '203.0.113.10, 198.51.100.20')
      .set('Cookie', 'sensitive-cookie=private')
      .expect(200);
    const second = await asAdmin(app).expect(200);
    expect(first.body.data).toMatchObject({
      diagnosticEnabled: true,
      proxyTrustMode: 'disabled',
      sameAddress: true,
      forwardedStatus: 'valid',
      forwardedHopCount: 2,
    });
    expect(first.body.data.socketPeerId).toMatch(/^p_[a-f0-9]{24}$/);
    expect(first.body.data.socketPeerId).toBe(first.body.data.expressClientId);
    expect(second.body.data.socketPeerId).toBe(first.body.data.socketPeerId);
    expect(second.body.data.forwardedStatus).toBe('absent');
    for (const privateValue of [
      '203.0.113.10',
      '198.51.100.20',
      '::1',
      'sensitive-cookie',
      adminToken,
      'staging-user',
      'stage-kv.internal',
    ]) {
      expect(JSON.stringify(first.body)).not.toContain(privateValue);
    }
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.headers['pragma']).toBe('no-cache');
    expect(first.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('uses different identifiers for different selected client addresses and each run', async () => {
    const source = enabledSource();
    const { app } = diagnosticApp({ source, trustedProxyCidrs: ['loopback'] });
    const first = await asAdmin(app).set('X-Forwarded-For', '203.0.113.1').expect(200);
    const second = await asAdmin(app).set('X-Forwarded-For', '203.0.113.2').expect(200);
    expect(first.body.data.proxyTrustMode).toBe('explicit');
    expect(first.body.data.socketPeerId).toBe(second.body.data.socketPeerId);
    expect(first.body.data.expressClientId).not.toBe(second.body.data.expressClientId);
    expect(first.body.data.sameAddress).toBe(false);

    const separateRun = diagnosticApp({ source, trustedProxyCidrs: ['loopback'] });
    const third = await asAdmin(separateRun.app).set('X-Forwarded-For', '203.0.113.1').expect(200);
    expect(third.body.data.expressClientId).not.toBe(first.body.data.expressClientId);
  });

  it('keeps proxy trust disabled and ignores spoofed forwarding values', async () => {
    const { app } = diagnosticApp({ source: enabledSource() });
    expect(app.get('trust proxy')).toBe(false);
    const first = await asAdmin(app).set('X-Forwarded-For', '203.0.113.1').expect(200);
    const second = await asAdmin(app).set('X-Forwarded-For', '198.51.100.2').expect(200);
    expect(first.body.data.expressClientId).toBe(second.body.data.expressClientId);
    expect(first.body.data.expressClientId).toBe(first.body.data.socketPeerId);
  });

  it('handles absent, malformed and excessive forwarded chains without exposing them', async () => {
    const { app } = diagnosticApp({ source: enabledSource() });
    const absent = await asAdmin(app).expect(200);
    const malformed = await asAdmin(app).set('X-Forwarded-For', 'not-an-ip').expect(200);
    const excessive = await asAdmin(app)
      .set('X-Forwarded-For', Array.from({ length: 17 }, () => '203.0.113.1').join(','))
      .expect(200);
    expect(absent.body.data.forwardedStatus).toBe('absent');
    expect(malformed.body.data).toMatchObject({
      forwardedStatus: 'malformed',
      forwardedHopCount: 0,
    });
    expect(excessive.body.data.forwardedStatus).toBe('malformed');
    expect(JSON.stringify(malformed.body)).not.toContain('not-an-ip');
  });

  it('does not log complete headers or forwarded values on denied requests', async () => {
    const output: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ level: 'warn' }, sink);
    const { app } = diagnosticApp({ source: enabledSource(), logger });
    await request(app)
      .get(path)
      .set('X-Forwarded-For', '203.0.113.27')
      .set('Cookie', 'private-cookie=secret')
      .set('Authorization', 'Bearer private-token')
      .expect(401);
    await asAdmin(app).set('X-Forwarded-For', '198.51.100.9').expect(200);
    const logs = output.join('');
    expect(logs).not.toContain('203.0.113.27');
    expect(logs).not.toContain('198.51.100.9');
    expect(logs).not.toContain('private-cookie');
    expect(logs).not.toContain('private-token');
    expect(logs).not.toContain(adminToken);
    expect(logs).not.toContain('x-forwarded-for');
  });

  it('generates its own request ID and never logs the caller-supplied value', async () => {
    const output: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ level: 'warn' }, sink);
    const { app } = diagnosticApp({ source: enabledSource(), logger });
    const supplied = 'SensitivePasswordLooksLikeARequestId';
    const response = await request(app).get(path).set('X-Request-ID', supplied).expect(401);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).not.toBe(supplied);
    expect(JSON.stringify(response.body) + output.join('')).not.toContain(supplied);
  });

  it('redacts unexpected authentication errors from responses and diagnostic logs', async () => {
    const output: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ level: 'warn' }, sink);
    const { app } = diagnosticApp({ source: enabledSource(), logger });
    const sensitive = 'mongodb+srv://private-user:private-password@private-host.example/';
    const lookup = vi.spyOn(User, 'findById').mockImplementationOnce(() => {
      throw new Error(sensitive);
    });
    try {
      const response = await asAdmin(app).set('X-Forwarded-For', '203.0.113.27').expect(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(JSON.stringify(response.body) + output.join('')).not.toContain(sensitive);
      expect(output.join('')).not.toContain('203.0.113.27');
      expect(output.join('')).not.toContain(adminToken);
    } finally {
      lookup.mockRestore();
    }
  });

  it('redacts unexpected response-construction errors', async () => {
    const output: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ level: 'warn' }, sink);
    const { app } = diagnosticApp({ source: enabledSource(), logger });
    const sensitive = 'private-token-and-forwarded-header-value';
    const originalJson = app.response.json;
    let injected = false;
    const send = vi.spyOn(app.response, 'json').mockImplementation(function (this: Response, body) {
      if (!injected && this.statusCode === 200) {
        injected = true;
        throw new Error(sensitive);
      }
      return originalJson.call(this, body);
    });
    try {
      const response = await asAdmin(app).expect(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(JSON.stringify(response.body) + output.join('')).not.toContain(sensitive);
    } finally {
      send.mockRestore();
    }
  });

  it.each([
    ['response write', true, false, false],
    ['socket cleanup', false, true, true],
    ['response write and socket cleanup', true, true, true],
  ])(
    'contains %s failures without reaching the normal logger',
    (_scenario, jsonFails, endFails, destroyFails) => {
      const sensitive = 'mongodb+srv://private-user:private-password@private-host.example/';
      const privateLog = vi.fn();
      const next = vi.fn() as NextFunction;
      const destroy = vi.fn(() => {
        if (destroyFails) throw new Error(`socket failure: ${sensitive}`);
      });
      const req = {
        log: { error: privateLog, warn: privateLog },
        socket: { destroy },
      } as unknown as Request;
      const responseBody: unknown[] = [];
      const res = {
        headersSent: !jsonFails,
        status: vi.fn().mockReturnThis(),
        json: vi.fn((body: unknown) => {
          if (jsonFails) throw new Error(`write failure: ${sensitive}`);
          responseBody.push(body);
        }),
        end: vi.fn(() => {
          if (endFails) throw new Error(`end failure: ${sensitive}`);
        }),
      } as unknown as Response;

      expect(() => diagnosticErrorHandler(new Error(sensitive), req, res, next)).not.toThrow();
      expect(next).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(endFails ? 1 : 0);
      expect(privateLog).toHaveBeenCalledWith(
        { code: 'INTERNAL_ERROR', status: 500 },
        'Diagnostic request rejected',
      );
      expect(JSON.stringify(responseBody) + JSON.stringify(privateLog.mock.calls)).not.toContain(
        sensitive,
      );
    },
  );
});
