import * as argon2 from 'argon2';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { migrateLegacyAuditLog } from '../src/modules/audit/migrate.js';
import { Session } from '../src/modules/auth/model.js';
import { Role } from '../src/modules/roles/model.js';
import { seedDefaultRoles } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { PASSWORD_HASH_OPTIONS } from '../src/modules/users/service.js';
import { createTestApp, silentLogger, unlimitedTestLoginLimiter } from './helpers.js';

const app = createTestApp();
const productionApp = createApp({
  logger: silentLogger,
  environment: 'production',
  corsOrigins: ['https://inventory.example.com'],
  trustedProxyCidrs: [],
  loginLimiter: unlimitedTestLoginLimiter,
  rateLimitReady: () => true,
  auth: {
    accessTokenSecret: 'test-access-token-secret-that-is-at-least-32-characters',
    refreshTokenSecret: 'test-refresh-token-secret-that-is-at-least-32-characters',
    secureCookies: true,
  },
});
const password = 'Correct horse battery staple 2026';

beforeAll(async () => {
  await Promise.all([
    Role.createCollection(),
    User.createCollection(),
    Session.createCollection(),
    AuditLog.createCollection(),
  ]);
  await Promise.all([
    Role.syncIndexes(),
    User.syncIndexes(),
    Session.syncIndexes(),
    AuditLog.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}),
    Session.deleteMany({}),
    User.deleteMany({}),
    Role.deleteMany({}),
  ]);
  await seedDefaultRoles();
  await AuditLog.deleteMany({});
});

async function signedIn(roleName: string) {
  const role = await Role.findOne({ name: roleName });
  if (!role) throw new Error(`Role ${roleName} was not seeded`);
  const email = `${roleName.toLowerCase().replace(/[^a-z]/g, '')}@example.com`;
  await User.create({
    name: roleName,
    email,
    passwordHash: await argon2.hash(password, PASSWORD_HASH_OPTIONS),
    roleIds: [role._id],
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return `Bearer ${login.body.data.accessToken as string}`;
}

function event(at: Date, overrides: Record<string, unknown> = {}) {
  return {
    action: 'user.update',
    entityType: 'user',
    entityId: String(new Types.ObjectId()),
    at,
    ...overrides,
  };
}

describe('read-only audit history', () => {
  it('enforces audit.read for direct list and detail requests', async () => {
    const record = await AuditLog.create(event(new Date()));
    await request(app).get('/api/v1/audit-logs').expect(401);
    await request(app).get(`/api/v1/audit-logs/${record._id}`).expect(401);
    const storekeeper = await signedIn('Storekeeper');
    await request(app).get('/api/v1/audit-logs').set('Authorization', storekeeper).expect(403);
    await request(app)
      .get(`/api/v1/audit-logs/${record._id}`)
      .set('Authorization', storekeeper)
      .expect(403);
    for (const role of ['Admin', 'Owner / Manager', 'Viewer / Auditor']) {
      const authorization = await signedIn(role);
      await request(app).get('/api/v1/audit-logs').set('Authorization', authorization).expect(200);
      await request(app)
        .get(`/api/v1/audit-logs/${record._id}`)
        .set('Authorization', authorization)
        .expect(200);
    }
    await request(app).post('/api/v1/audit-logs').set('Authorization', storekeeper).expect(404);
  });

  it('rejects malformed and unsupported filters, dates, IDs, limits and cursors', async () => {
    const authorization = await signedIn('Admin');
    for (const query of [
      '?unknown=value',
      '?user=bad',
      '?entityId=bad',
      '?from=yesterday',
      '?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      '?limit=101',
      '?limit=0',
      '?action=%24ne',
      '?cursor=not-a-cursor',
    ]) {
      await request(app)
        .get(`/api/v1/audit-logs${query}`)
        .set('Authorization', authorization)
        .expect(400);
    }
    await request(app)
      .get('/api/v1/audit-logs/invalid-id')
      .set('Authorization', authorization)
      .expect(400);
  });

  it('filters on UTC boundaries and matches an affected user without an actor', async () => {
    const authorization = await signedIn('Admin');
    const affected = new Types.ObjectId();
    const inside = await AuditLog.create(
      event(new Date('2026-01-02T00:00:00.000Z'), {
        action: 'auth.login.failed',
        entityId: String(affected),
        metadata: { reason: 'inactive_account' },
      }),
    );
    await AuditLog.create(
      event(new Date('2026-01-01T23:59:59.999Z'), { entityId: String(affected) }),
    );
    const result = await request(app)
      .get(
        `/api/v1/audit-logs?user=${affected}&action=auth.login.failed&from=2026-01-02T00:00:00.000Z&to=2026-01-02T23:59:59.999Z`,
      )
      .set('Authorization', authorization)
      .expect(200);
    expect(result.body.data.map((item: { id: string }) => item.id)).toEqual([String(inside._id)]);
    expect(result.body.data[0].actorId).toBeNull();
    expect(result.body.data[0].at).toBe('2026-01-02T00:00:00.000Z');
  });

  it('paginates equal timestamps without repeats and keeps a fixed upper bound', async () => {
    const authorization = await signedIn('Admin');
    const at = new Date(Date.now() - 60_000);
    const records = await AuditLog.create([event(at), event(at), event(at)]);
    const first = await request(app)
      .get('/api/v1/audit-logs?limit=2&action=user.update')
      .set('Authorization', authorization)
      .expect(200);
    expect(first.body.meta.hasMore).toBe(true);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    await AuditLog.create(event(new Date(Date.now() + 60_000)));
    const second = await request(app)
      .get(
        `/api/v1/audit-logs?limit=2&action=user.update&cursor=${first.body.meta.nextCursor as string}`,
      )
      .set('Authorization', authorization)
      .expect(200);
    const ids = [...first.body.data, ...second.body.data].map((row: { id: string }) => row.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(
      records
        .map((record) => String(record._id))
        .sort()
        .reverse(),
    );
    expect(second.body.meta.hasMore).toBe(false);
    expect(second.body.meta.nextCursor).toBeNull();
    await request(app)
      .get(`/api/v1/audit-logs?action=role.update&cursor=${first.body.meta.nextCursor as string}`)
      .set('Authorization', authorization)
      .expect(400);
  });

  it('redacts planted secrets and personal fields from current and historical payloads', async () => {
    const authorization = await signedIn('Admin');
    const record = await AuditLog.create(
      event(new Date(), {
        before: {
          email: 'private@example.com',
          passwordHash: 'secret-hash',
          isActive: false,
          changes: { refreshToken: 'secret-token', isActive: true },
        },
        after: {
          credentials: { password: 'secret-password' },
          roleIds: [String(new Types.ObjectId())],
          name: 'Private Person',
        },
        metadata: {
          authorization: 'Bearer secret-token',
          requestBody: { password: 'secret-password' },
          reason: 'invalid_password',
          unknown: 'private@example.com',
        },
      }),
    );
    const db = AuditLog.db.db;
    if (!db) throw new Error('Test database is not connected');
    const historicalId = new Types.ObjectId();
    await db.collection('audit_logs').insertOne({
      _id: historicalId,
      action: 'legacy.event',
      entityType: 'user',
      entityId: 'private@example.com',
      at: new Date(),
      metadata: {
        accessToken: 'legacy-secret',
        nested: { password: 'legacy-password' },
        unknown: 'private@example.com',
      },
    });
    const list = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', authorization)
      .expect(200);
    const detail = await request(app)
      .get(`/api/v1/audit-logs/${record._id}`)
      .set('Authorization', authorization)
      .expect(200);
    const historical = await request(app)
      .get(`/api/v1/audit-logs/${historicalId}`)
      .set('Authorization', authorization)
      .expect(200);
    const body = JSON.stringify([list.body, detail.body, historical.body]);
    for (const secret of [
      'private@example.com',
      'secret-hash',
      'secret-token',
      'secret-password',
      'legacy-secret',
      'legacy-password',
      'Private Person',
    ]) {
      expect(body).not.toContain(secret);
    }
    expect(detail.body.data.before).toMatchObject({ isActive: false, changes: { isActive: true } });
    expect(detail.body.data.metadata).toEqual({ reason: 'invalid_password' });
    expect(historical.body.data.entityId).toBe('[redacted]');
    expect(historical.body.data.action).toBe('[redacted]');
  });

  it('preserves a legacy audit_log record through migration and redacts it on read', async () => {
    const authorization = await signedIn('Admin');
    const db = AuditLog.db.db;
    if (!db) throw new Error('Test database is not connected');
    const legacyId = new Types.ObjectId();
    await db.collection('audit_log').insertOne({
      _id: legacyId,
      action: 'legacy.event',
      entityType: 'user',
      entityId: 'private@example.com',
      at: new Date(),
      details: { password: 'historical-secret', isActive: false },
    });
    await migrateLegacyAuditLog();
    const stored = await AuditLog.findById(legacyId);
    expect(stored?.metadata).toEqual({ password: 'historical-secret', isActive: false });
    const detail = await request(app)
      .get(`/api/v1/audit-logs/${legacyId}`)
      .set('Authorization', authorization)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: String(legacyId),
      action: '[redacted]',
      entityId: '[redacted]',
      metadata: { isActive: false },
    });
    expect(JSON.stringify(detail.body)).not.toContain('historical-secret');
    expect(JSON.stringify(detail.body)).not.toContain('private@example.com');
  });

  it('audits a read once with safe metadata and releases no history if auditing fails', async () => {
    const authorization = await signedIn('Admin');
    const record = await AuditLog.create(event(new Date()));
    const first = await request(app)
      .get('/api/v1/audit-logs?action=user.update')
      .set('Authorization', authorization)
      .expect(200);
    expect(first.body.data).toHaveLength(1);
    const read = await AuditLog.findOne({ action: 'audit.history.read' });
    expect(read?.metadata).toEqual({ filterNames: ['action'], resultCount: 1 });
    expect(await AuditLog.countDocuments({ action: 'audit.history.read' })).toBe(1);

    const failure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      const denied = await request(productionApp)
        .get('/api/v1/audit-logs')
        .set('Authorization', authorization)
        .expect(500);
      expect(denied.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(denied.body).not.toHaveProperty('data');
    } finally {
      failure.mockRestore();
    }
    const detailFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      const denied = await request(productionApp)
        .get(`/api/v1/audit-logs/${record._id}`)
        .set('Authorization', authorization)
        .expect(500);
      expect(denied.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(denied.body).not.toHaveProperty('data');
    } finally {
      detailFailure.mockRestore();
    }
  });
});
