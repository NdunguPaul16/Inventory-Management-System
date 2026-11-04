import * as argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../src/modules/auth/model.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES, seedDefaultRoles } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { PASSWORD_HASH_OPTIONS } from '../src/modules/users/service.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
const password = 'Correct horse battery staple 2026';

beforeAll(async () => {
  await Promise.all([Role.createCollection(), User.createCollection(), Session.createCollection()]);
  await Promise.all([Role.syncIndexes(), User.syncIndexes(), Session.syncIndexes()]);
});

beforeEach(async () => {
  await Promise.all([Session.deleteMany({}), User.deleteMany({}), Role.deleteMany({})]);
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
