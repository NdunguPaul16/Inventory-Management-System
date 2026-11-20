import * as argon2 from 'argon2';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/auth/model.js';
import { StockAction } from '../src/modules/inventory/action-model.js';
import { hasPermission } from '../src/middleware/require-permission.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES, seedDefaultRoles } from '../src/modules/roles/service.js';
import { BootstrapLock } from '../src/modules/users/bootstrap-lock-model.js';
import { User } from '../src/modules/users/model.js';
import {
  PASSWORD_HASH_OPTIONS,
  bootstrapAdministrator,
  updateUser,
} from '../src/modules/users/service.js';
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
    BootstrapLock.createCollection(),
    Session.createCollection(),
    StockAction.createCollection(),
  ]);
  await Promise.all([
    Role.syncIndexes(),
    User.syncIndexes(),
    Session.syncIndexes(),
    StockAction.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    Session.deleteMany({}),
    AuditLog.deleteMany({}),
    User.deleteMany({}),
    BootstrapLock.deleteMany({}),
    Role.deleteMany({}),
    StockAction.deleteMany({}),
  ]);
  await seedDefaultRoles();
});

async function createUser(roleName: string, email: string) {
  const role = await Role.findOne({ name: roleName });
  if (!role) throw new Error(`Test role ${roleName} was not seeded`);
  return User.create({
    name: email.split('@')[0],
    email,
    passwordHash: await argon2.hash(password, PASSWORD_HASH_OPTIONS),
    roleIds: [role._id],
  });
}

describe('authentication and roles', () => {
  it('seeds every documented default role', async () => {
    expect(await Role.countDocuments()).toBe(DEFAULT_ROLES.length);
    expect((await Role.findOne({ name: 'Admin' }).lean())?.permissions).toEqual(['*']);
  });

  it('creates the initial administrator with the Admin role and a bootstrap audit event', async () => {
    expect(
      await bootstrapAdministrator({
        name: 'Amina Otieno',
        email: 'AMINA@example.com',
        password,
      }),
    ).toBe(true);

    const user = await User.findOne({ email: 'amina@example.com' }).select('+passwordHash');
    const administrator = await Role.findOne({ name: 'Admin' });
    expect(user).toBeTruthy();
    expect(user?.roleIds.map(String)).toEqual([String(administrator?._id)]);
    expect(await argon2.verify(user!.passwordHash, password)).toBe(true);
    const audit = await AuditLog.findOne({ action: 'user.bootstrap', entityId: String(user?._id) });
    expect(audit).toMatchObject({
      action: 'user.bootstrap',
      metadata: { source: 'cli' },
    });
    expect(audit?.after).not.toHaveProperty('passwordHash');
    expect(audit?.after).not.toHaveProperty('password');
  });

  it('does not create another administrator when bootstrap is repeated', async () => {
    const input = { name: 'Amina Otieno', email: 'amina@example.com', password };
    await expect(bootstrapAdministrator(input)).resolves.toBe(true);
    await expect(bootstrapAdministrator(input)).resolves.toBe(false);
    expect(await User.countDocuments()).toBe(1);
  });

  it('creates only one initial administrator during concurrent bootstrap attempts', async () => {
    const results = await Promise.all([
      bootstrapAdministrator({ name: 'Amina Otieno', email: 'amina@example.com', password }),
      bootstrapAdministrator({ name: 'Brian Mwangi', email: 'brian@example.com', password }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await User.countDocuments()).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'user.bootstrap' })).toBe(1);
  });

  it('rejects invalid bootstrap credentials without creating a user', async () => {
    await expect(
      bootstrapAdministrator({ name: 'A', email: 'not-an-email', password: 'short' }),
    ).rejects.toThrow();
    expect(await User.countDocuments()).toBe(0);
  });

  it('refuses bootstrap if any unrelated user already exists', async () => {
    const existing = await createUser('Storekeeper', 'storekeeper@example.com');
    await expect(
      bootstrapAdministrator({ name: 'Amina Otieno', email: 'amina@example.com', password }),
    ).resolves.toBe(false);
    expect(await User.countDocuments()).toBe(1);
    expect((await User.findById(existing._id))?.roleIds.map(String)).toEqual(
      existing.roleIds.map(String),
    );
    expect(await User.exists({ email: 'amina@example.com' })).toBeNull();
  });

  it('fails safely if the Admin role has not been initialized', async () => {
    await Role.deleteOne({ name: 'Admin' });
    await expect(
      bootstrapAdministrator({ name: 'Amina Otieno', email: 'amina@example.com', password }),
    ).rejects.toThrow('Default Admin role has not been seeded');
    expect(await User.countDocuments()).toBe(0);
  });

  it('does not expose a public administrator bootstrap endpoint', async () => {
    await request(app)
      .post('/api/v1/auth/bootstrap')
      .send({ name: 'Amina Otieno', email: 'amina@example.com', password })
      .expect(404);
  });

  it('issues an access token and an httpOnly refresh cookie, then returns the signed-in user', async () => {
    await createUser('Admin', 'admin@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@example.com', password })
      .expect(200);

    expect(login.body.data.user.email).toBe('admin@example.com');
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    expect(login.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^ims_refresh=.*HttpOnly/i)]),
    );

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data).toMatchObject({ email: 'admin@example.com', permissions: ['*'] });
  });

  it('returns the same login error and safe audit events for wrong, unknown and inactive accounts', async () => {
    const administrator = await createUser('Admin', 'admin@example.com');
    const inactiveUser = await createUser('Storekeeper', 'inactive@example.com');
    inactiveUser.isActive = false;
    await inactiveUser.save();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' })
      .expect(401);
    const unknownAccount = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password: 'wrong-password' })
      .expect(401);
    const inactiveAccount = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@example.com', password })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownAccount.body);
    expect(inactiveAccount.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(unknownAccount.headers['set-cookie']).toBeUndefined();
    expect(inactiveAccount.headers['set-cookie']).toBeUndefined();
    expect(await Session.countDocuments()).toBe(0);
    const failures = await AuditLog.find({ action: 'auth.login.failed' }).lean();
    expect(failures).toHaveLength(3);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          entityId: String(administrator._id),
          metadata: expect.objectContaining({ reason: 'invalid_password', failedLoginCount: 1 }),
        }),
        expect.objectContaining({
          entityType: 'authentication_attempt',
          entityId: 'unidentified',
          metadata: { reason: 'unknown_account' },
        }),
        expect.objectContaining({
          entityType: 'user',
          entityId: String(inactiveUser._id),
          metadata: { reason: 'inactive_account' },
        }),
      ]),
    );
    expect(failures.every((failure) => failure.actorId === undefined)).toBe(true);
    const auditText = JSON.stringify(failures);
    for (const sensitiveValue of [
      'admin@example.com',
      'unknown@example.com',
      'inactive@example.com',
      'wrong-password',
      password,
    ]) {
      expect(auditText).not.toContain(sensitiveValue);
    }
  });

  it.each(['unknown', 'inactive', 'locked'] as const)(
    'denies %s account login if its audit event cannot be saved',
    async (accountState) => {
      let email = 'unknown@example.com';
      if (accountState !== 'unknown') {
        const user = await createUser('Storekeeper', `${accountState}@example.com`);
        email = user.email;
        if (accountState === 'inactive') user.isActive = false;
        else user.lockedUntil = new Date(Date.now() + 60_000);
        await user.save();
      }
      const auditCount = await AuditLog.countDocuments();
      const auditFailure = vi
        .spyOn(AuditLog, 'create')
        .mockRejectedValueOnce(new Error('simulated audit write failure'));
      try {
        const denied = await request(productionApp)
          .post('/api/v1/auth/login')
          .send({ email, password })
          .expect(500);
        expect(denied.body).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        });
        expect(denied.headers['set-cookie']).toBeUndefined();
        expect(denied.body).not.toHaveProperty('data.accessToken');
      } finally {
        auditFailure.mockRestore();
      }
      expect(await AuditLog.countDocuments()).toBe(auditCount);
      expect(await Session.countDocuments()).toBe(0);
    },
  );

  it('rolls back the failed-login counter if its audit event cannot be saved', async () => {
    const user = await createUser('Admin', 'admin@example.com');
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit write failure'));
    try {
      const denied = await request(productionApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password' })
        .expect(500);
      expect(denied.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(denied.headers['set-cookie']).toBeUndefined();
    } finally {
      auditFailure.mockRestore();
    }
    expect((await User.findById(user._id))?.failedLoginCount).toBe(0);
    expect(await Session.countDocuments()).toBe(0);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401);
    expect((await User.findById(user._id))?.failedLoginCount).toBe(1);
  });

  it('does not issue a session if a successful-login audit event cannot be saved', async () => {
    const user = await createUser('Admin', 'admin@example.com');
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit write failure'));
    try {
      const denied = await request(productionApp)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(500);
      expect(denied.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(denied.headers['set-cookie']).toBeUndefined();
      expect(denied.body).not.toHaveProperty('data.accessToken');
    } finally {
      auditFailure.mockRestore();
    }
    expect(await Session.countDocuments()).toBe(0);
    expect((await User.findById(user._id))?.lastLoginAt).toBeUndefined();
  });

  it('rotates refresh sessions and rejects the used refresh token', async () => {
    await createUser('Admin', 'admin@example.com');
    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const initialCookie = login.headers['set-cookie']?.[0];
    expect(initialCookie).toBeTruthy();

    const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
    const nextCookie = refreshed.headers['set-cookie']?.[0];
    expect(nextCookie).toBeTruthy();

    await request(app).post('/api/v1/auth/refresh').set('Cookie', initialCookie!).expect(401);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', nextCookie!).expect(200);
  });

  it('protects the production refresh cookie and revokes it on logout', async () => {
    const user = await createUser('Admin', 'admin@example.com');
    const login = await request(productionApp)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const cookie = login.headers['set-cookie']?.[0] as string | undefined;
    expect(cookie).toMatch(/^ims_refresh=.*; HttpOnly; Secure; SameSite=Lax/i);
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(login.body.data).not.toHaveProperty('refreshToken');

    const refreshToken = cookie?.split(';')[0]?.split('=')[1];
    expect(refreshToken).toBeTruthy();
    const stored = await Session.findOne({ userId: user._id }).select('+tokenHash');
    expect(stored?.tokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(stored?.tokenHash).not.toBe(refreshToken);

    await request(productionApp).post('/api/v1/auth/refresh').expect(401);
    await request(productionApp)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
    await request(productionApp).post('/api/v1/auth/logout').set('Cookie', cookie!).expect(204);
    await request(productionApp).post('/api/v1/auth/refresh').set('Cookie', cookie!).expect(401);
    expect(await AuditLog.countDocuments({ action: 'auth.logout', actorId: user._id })).toBe(1);
  });

  it('rejects access and refresh for a user after an administrator deactivates the account', async () => {
    await createUser('Admin', 'admin@example.com');
    const storekeeper = await createUser('Storekeeper', 'storekeeper@example.com');
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const storekeeperLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'storekeeper@example.com', password })
      .expect(200);
    const storekeeperCookie = storekeeperLogin.headers['set-cookie']?.[0] as string;

    await request(app)
      .patch(`/api/v1/users/${storekeeper._id}`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ isActive: false })
      .expect(200);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${storekeeperLogin.body.data.accessToken}`)
      .expect(401);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', storekeeperCookie).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'storekeeper@example.com', password })
      .expect(401);
  });

  it('enforces role permissions on users endpoints', async () => {
    await createUser('Admin', 'admin@example.com');
    await createUser('Viewer / Auditor', 'viewer@example.com');
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password });
    const viewerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@example.com', password });

    await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    const blocked = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${viewerLogin.body.data.accessToken}`)
      .expect(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
  });

  it('creates and edits roles and users through the existing administration routes', async () => {
    await createUser('Admin', 'admin@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;

    const role = await request(app)
      .post('/api/v1/roles')
      .set('Authorization', authorization)
      .send({
        name: 'Stock Reader',
        description: 'Reads balances',
        permissions: ['inventory.balances.read'],
      })
      .expect(201);
    const roleId = role.body.data.id as string;
    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', authorization)
      .send({ name: 'Amina Otieno', email: 'amina@example.com', password, roleIds: [roleId] })
      .expect(201);
    expect(created.body.data.roles[0].name).toBe('Stock Reader');
    const userId = created.body.data.id as string;

    const updated = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set('Authorization', authorization)
      .send({
        name: 'Amina O.',
        isActive: false,
        roleIds: [String((await Role.findOne({ name: 'Storekeeper' }))!._id)],
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Amina O.', isActive: false });
    expect(updated.body.data.roles[0].name).toBe('Storekeeper');
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'amina@example.com', password })
      .expect(401);

    const updatedRole = await request(app)
      .patch(`/api/v1/roles/${roleId}`)
      .set('Authorization', authorization)
      .send({ permissions: ['inventory.balances.read', 'inventory.layers.read'] })
      .expect(200);
    expect(updatedRole.body.data.permissions).toEqual([
      'inventory.balances.read',
      'inventory.layers.read',
    ]);

    const systemRoleId = String((await Role.findOne({ name: 'Admin' }))!._id);
    await request(app)
      .patch(`/api/v1/roles/${systemRoleId}`)
      .set('Authorization', authorization)
      .send({ permissions: ['users.read'] })
      .expect(400);
    const description = await request(app)
      .patch(`/api/v1/roles/${systemRoleId}`)
      .set('Authorization', authorization)
      .send({ description: 'Platform administrators' })
      .expect(200);
    expect(description.body.data.permissions).toEqual(['*']);
  });

  it('allows role viewing without granting permission to edit role permissions', async () => {
    const [readerRole] = await Role.create([
      { name: 'Role Reader', permissions: ['roles.read'], isSystem: false },
    ]);
    if (!readerRole) throw new Error('Role Reader was not created');
    await User.create({
      name: 'Role Reader',
      email: 'reader@example.com',
      passwordHash: await argon2.hash(password, PASSWORD_HASH_OPTIONS),
      roleIds: [readerRole._id],
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reader@example.com', password })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    await request(app).get('/api/v1/roles').set('Authorization', authorization).expect(200);
    await request(app)
      .patch(`/api/v1/roles/${readerRole._id}`)
      .set('Authorization', authorization)
      .send({ permissions: ['*'] })
      .expect(403);
  });

  it('lets an administrator edit and approve while a Storekeeper cannot change an Admin role or approve stock', async () => {
    const administrator = await createUser('Admin', 'admin@example.com');
    const storekeeper = await createUser('Storekeeper', 'storekeeper@example.com');
    const adminRole = await Role.findOne({ name: 'Admin' });
    const storekeeperRole = await Role.findOne({ name: 'Storekeeper' });
    if (!adminRole || !storekeeperRole) throw new Error('Default roles were not seeded');
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const storekeeperLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'storekeeper@example.com', password })
      .expect(200);
    const adminAuthorization = `Bearer ${adminLogin.body.data.accessToken}`;
    const storekeeperAuthorization = `Bearer ${storekeeperLogin.body.data.accessToken}`;
    const action = await StockAction.create({
      actionNo: 'TEST-ADMIN-APPROVAL',
      actionType: 'OPENING',
      payload: {
        itemId: String(new Types.ObjectId()),
        locationId: String(new Types.ObjectId()),
        quantity: '1',
        unitCost: '1',
      },
      requestedBy: storekeeper._id,
    });

    await request(app)
      .patch(`/api/v1/roles/${adminRole._id}`)
      .set('Authorization', storekeeperAuthorization)
      .send({ description: 'Escalated by Storekeeper' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/users/${administrator._id}`)
      .set('Authorization', storekeeperAuthorization)
      .send({ roleIds: [storekeeperRole._id] })
      .expect(403);
    await request(app)
      .post(`/api/v1/inventory/requests/${action._id}/approve`)
      .set('Authorization', storekeeperAuthorization)
      .expect(403);
    expect((await Role.findById(adminRole._id))?.description).toBe(adminRole.description);
    expect((await User.findById(administrator._id))?.roleIds.map(String)).toEqual(
      administrator.roleIds.map(String),
    );
    expect((await StockAction.findById(action._id))?.status).toBe('PENDING_APPROVAL');
    expect(await AuditLog.countDocuments({ action: 'role.update' })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'stock.action.approve' })).toBe(0);

    await request(app)
      .patch(`/api/v1/roles/${adminRole._id}`)
      .set('Authorization', adminAuthorization)
      .send({ description: 'Platform administrators' })
      .expect(200);
    await request(app)
      .post(`/api/v1/inventory/requests/${action._id}/approve`)
      .set('Authorization', adminAuthorization)
      .expect(200);
    const roleAudit = await AuditLog.findOne({
      action: 'role.update',
      entityId: String(adminRole._id),
    });
    expect(roleAudit).toMatchObject({
      actorId: administrator._id,
      before: { description: adminRole.description, permissions: ['*'] },
      after: { description: 'Platform administrators', permissions: ['*'] },
    });
    const approvalAudit = await AuditLog.findOne({
      action: 'stock.action.approve',
      entityId: String(action._id),
    });
    expect(approvalAudit).toMatchObject({ actorId: administrator._id });
    expect(approvalAudit?.before).toMatchObject({ status: 'PENDING_APPROVAL' });
    expect(approvalAudit?.after).toMatchObject({ status: 'APPROVED' });
  });

  it('blocks a Storekeeper from opening stock, reversals and approving or posting stock actions', async () => {
    const storekeeperRole = await Role.findOne({ name: 'Storekeeper' });
    const managerRole = await Role.findOne({ name: 'Owner / Manager' });
    expect(storekeeperRole).toBeTruthy();
    expect(managerRole).toBeTruthy();
    expect(hasPermission(storekeeperRole!.permissions, 'inventory.adjustments.request')).toBe(true);
    for (const area of ['opening', 'adjustments', 'movements.reverse']) {
      for (const operation of ['approve', 'post']) {
        const permission = `inventory.${area}.${operation}`;
        expect(hasPermission(storekeeperRole!.permissions, permission)).toBe(false);
        expect(hasPermission(managerRole!.permissions, permission)).toBe(true);
      }
    }

    await createUser('Storekeeper', 'storekeeper@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'storekeeper@example.com', password })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    await request(app)
      .post('/api/v1/inventory/opening-stock')
      .set('Authorization', authorization)
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/v1/inventory/movements/${new Types.ObjectId()}/reverse`)
      .set('Authorization', authorization)
      .send({ reason: 'Correction requested' })
      .expect(403);

    for (const actionType of ['OPENING', 'ADJUSTMENT', 'REVERSAL'] as const) {
      const action = await StockAction.create({
        actionNo: `TEST-${actionType}`,
        actionType,
        payload: {},
        requestedBy: new Types.ObjectId(),
      });
      await request(app)
        .post(`/api/v1/inventory/requests/${action._id}/approve`)
        .set('Authorization', authorization)
        .expect(403);
      action.status = 'APPROVED';
      action.approvedBy = new Types.ObjectId();
      await action.save();
      await request(app)
        .post(`/api/v1/inventory/requests/${action._id}/post`)
        .set('Authorization', authorization)
        .expect(403);
      expect((await StockAction.findById(action._id))?.status).toBe('APPROVED');
    }
  });

  it('denies stock approval, rejection and posting before request lookup when no action permission is held', async () => {
    await createUser('Storekeeper', 'storekeeper@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'storekeeper@example.com', password })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const action = await StockAction.create({
      actionNo: 'TEST-RESTRICTED-REQUEST',
      actionType: 'OPENING',
      payload: { secret: 'restricted request details' },
      requestedBy: new Types.ObjectId(),
    });
    for (const operation of ['approve', 'reject', 'post']) {
      for (const requestId of [String(action._id), String(new Types.ObjectId())]) {
        const response = await request(app)
          .post(`/api/v1/inventory/requests/${requestId}/${operation}`)
          .set('Authorization', authorization)
          .send(operation === 'reject' ? { reason: 'Not approved' } : {})
          .expect(403);
        expect(JSON.stringify(response.body)).not.toContain('restricted request details');
      }
    }
    expect((await StockAction.findById(action._id))?.status).toBe('PENDING_APPROVAL');
  });

  it('conceals requests outside a scoped system-manager permission while preserving allowed approval', async () => {
    const role = await Role.findOneAndUpdate(
      { name: 'Owner / Manager', isSystem: true },
      { $set: { permissions: ['inventory.opening.approve', 'inventory.opening.post'] } },
      { returnDocument: 'after' },
    );
    if (!role) throw new Error('System Manager role was not seeded');
    const user = await User.create({
      name: 'Scoped approver',
      email: 'scoped@example.com',
      passwordHash: await argon2.hash(password, PASSWORD_HASH_OPTIONS),
      roleIds: [role._id],
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'scoped@example.com', password })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const restricted = await StockAction.create({
      actionNo: 'TEST-RESTRICTED-ADJUSTMENT',
      actionType: 'ADJUSTMENT',
      payload: { secret: 'restricted adjustment details' },
      requestedBy: new Types.ObjectId(),
    });
    const missingId = String(new Types.ObjectId());
    for (const operation of ['approve', 'reject', 'post']) {
      for (const requestId of [String(restricted._id), missingId]) {
        const response = await request(app)
          .post(`/api/v1/inventory/requests/${requestId}/${operation}`)
          .set('Authorization', authorization)
          .send(operation === 'reject' ? { reason: 'Not approved' } : {})
          .expect(404);
        expect(JSON.stringify(response.body)).not.toContain('restricted adjustment details');
      }
    }
    const allowed = await StockAction.create({
      actionNo: 'TEST-ALLOWED-OPENING',
      actionType: 'OPENING',
      payload: {
        itemId: String(new Types.ObjectId()),
        locationId: String(new Types.ObjectId()),
        quantity: '1',
        unitCost: '1',
      },
      requestedBy: new Types.ObjectId(),
    });
    await request(app)
      .post(`/api/v1/inventory/requests/${allowed._id}/approve`)
      .set('Authorization', authorization)
      .expect(200);
    expect((await StockAction.findById(allowed._id))?.approvedBy?.toString()).toBe(
      String(user._id),
    );
    const rejectable = await StockAction.create({
      actionNo: 'TEST-ALLOWED-REJECTION',
      actionType: 'OPENING',
      payload: allowed.payload,
      requestedBy: new Types.ObjectId(),
    });
    await request(app)
      .post(`/api/v1/inventory/requests/${rejectable._id}/reject`)
      .set('Authorization', authorization)
      .send({ reason: 'Incorrect opening balance' })
      .expect(200);
    expect((await StockAction.findById(rejectable._id))?.status).toBe('REJECTED');
    const posted = await StockAction.create({
      actionNo: 'TEST-ALLOWED-POST-REPLAY',
      actionType: 'OPENING',
      status: 'POSTED',
      payload: allowed.payload,
      requestedBy: new Types.ObjectId(),
      approvedBy: user._id,
      movementIds: [],
    });
    const replay = await request(app)
      .post(`/api/v1/inventory/requests/${posted._id}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(replay.body.data.posting.replayed).toBe(true);
    expect((await StockAction.findById(restricted._id))?.status).toBe('PENDING_APPROVAL');
  });

  it('rolls back an identity change when its audit write fails', async () => {
    const user = await createUser('Storekeeper', 'storekeeper@example.com');
    const originalHash = user.passwordHash;
    const auditCount = await AuditLog.countDocuments();
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit write failure'));
    try {
      await expect(
        updateUser(
          String(user._id),
          { name: 'Updated Storekeeper', password: 'A different secure password 2026' },
          String(new Types.ObjectId()),
        ),
      ).rejects.toThrow('simulated audit write failure');
    } finally {
      auditFailure.mockRestore();
    }
    const unchanged = await User.findById(user._id).select('+passwordHash');
    expect(unchanged?.name).toBe(user.name);
    expect(unchanged?.passwordHash).toBe(originalHash);
    expect(await AuditLog.countDocuments()).toBe(auditCount);
  });

  it('audits password changes without storing the password or hash', async () => {
    const administrator = await createUser('Admin', 'admin@example.com');
    const storekeeper = await createUser('Storekeeper', 'storekeeper@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const nextPassword = 'A different secure password 2026';
    await request(app)
      .patch(`/api/v1/users/${storekeeper._id}`)
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ password: nextPassword })
      .expect(200);

    const audit = await AuditLog.findOne({
      action: 'user.update',
      entityId: String(storekeeper._id),
    });
    expect(audit).toMatchObject({
      actorId: administrator._id,
      metadata: { passwordChanged: true },
    });
    const auditText = JSON.stringify(audit?.toObject());
    expect(auditText).not.toContain(password);
    expect(auditText).not.toContain(nextPassword);
    expect(auditText).not.toContain('passwordHash');
    const stored = await User.findById(storekeeper._id).select('+passwordHash');
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toBe(storekeeper.passwordHash);
  });

  it('rolls back a stock approval when its audit write fails', async () => {
    const administrator = await createUser('Admin', 'admin@example.com');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const action = await StockAction.create({
      actionNo: 'TEST-AUDIT-ROLLBACK',
      actionType: 'ADJUSTMENT',
      payload: {
        itemId: String(new Types.ObjectId()),
        locationId: String(new Types.ObjectId()),
        quantity: '1',
        direction: 'IN',
        unitCost: '1',
        reason: 'Test fixture',
      },
      requestedBy: new Types.ObjectId(),
    });
    const auditCount = await AuditLog.countDocuments();
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit write failure'));
    try {
      const failed = await request(app)
        .post(`/api/v1/inventory/requests/${action._id}/approve`)
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .expect(500);
      expect(failed.body.error.message).toBe('simulated audit write failure');
    } finally {
      auditFailure.mockRestore();
    }
    expect((await StockAction.findById(action._id))?.status).toBe('PENDING_APPROVAL');
    expect(await AuditLog.countDocuments()).toBe(auditCount);
    expect(
      await AuditLog.countDocuments({ actorId: administrator._id, action: 'stock.action.approve' }),
    ).toBe(0);
  });

  it('locks an account after repeated failed password attempts', async () => {
    const user = await createUser('Admin', 'admin@example.com');
    let invalidResponse: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const denied = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'wrong-password' })
        .expect(401);
      invalidResponse = denied.body;
    }
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(401);
    expect(locked.body).toEqual(invalidResponse);
    expect(locked.headers['set-cookie']).toBeUndefined();
    expect(await Session.countDocuments()).toBe(0);
    const lockedUser = await User.findById(user._id);
    expect(lockedUser?.failedLoginCount).toBe(5);
    expect(lockedUser?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(await AuditLog.countDocuments({ 'metadata.reason': 'invalid_password' })).toBe(5);
    expect(await AuditLog.countDocuments({ 'metadata.reason': 'locked_account' })).toBe(1);

    lockedUser!.lockedUntil = new Date(Date.now() - 1_000);
    await lockedUser!.save();
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(200);
    const unlockedUser = await User.findById(user._id);
    expect(unlockedUser?.failedLoginCount).toBe(0);
    expect(unlockedUser?.lockedUntil).toBeUndefined();
  });
});
