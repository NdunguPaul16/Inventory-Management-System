import * as argon2 from 'argon2';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/auth/model.js';
import { StockAction } from '../src/modules/inventory/action-model.js';
import { hasPermission } from '../src/middleware/require-permission.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES, seedDefaultRoles } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { PASSWORD_HASH_OPTIONS, updateUser } from '../src/modules/users/service.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
const password = 'Correct horse battery staple 2026';

beforeAll(async () => {
  await Promise.all([
    Role.createCollection(),
    User.createCollection(),
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
    User.deleteMany({}),
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

  it('locks an account after repeated failed password attempts', async () => {
    await createUser('Admin', 'admin@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'wrong-password' })
        .expect(401);
    }
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password })
      .expect(401);
  });
});
