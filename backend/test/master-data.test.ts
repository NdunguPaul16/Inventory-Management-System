import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';
import { Counter } from '../src/modules/counters/model.js';
import {
  CostLayer,
  PostingRequest,
  StockBalance,
  StockMovement,
} from '../src/modules/inventory/engine/models.js';
import { postIn } from '../src/modules/inventory/engine/service.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
let adminToken: string;
let storekeeperToken: string;
let adminId: Types.ObjectId;

function token(id: Types.ObjectId) {
  return `Bearer ${jwt.sign({ type: 'access' }, 'test-access-token-secret-that-is-at-least-32-characters', { subject: String(id), expiresIn: 60 })}`;
}

beforeAll(async () => {
  await Promise.all(
    [
      AuditLog,
      Counter,
      Item,
      Location,
      Role,
      User,
      StockBalance,
      StockMovement,
      CostLayer,
      PostingRequest,
    ].map((model) => model.createCollection()),
  );
  await Promise.all(
    [Item, Location, Role, User, StockBalance, StockMovement, CostLayer, PostingRequest].map(
      (model) => model.syncIndexes(),
    ),
  );
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}),
    Counter.deleteMany({}),
    Item.deleteMany({}),
    Location.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
    StockBalance.deleteMany({}),
    StockMovement.deleteMany({}),
    CostLayer.deleteMany({}),
    PostingRequest.deleteMany({}),
  ]);
  const [adminRole, storeRole] = await Role.create([
    DEFAULT_ROLES.find((role) => role.name === 'Admin')!,
    DEFAULT_ROLES.find((role) => role.name === 'Storekeeper')!,
  ]);
  if (!adminRole || !storeRole) throw new Error('Roles were not created');
  const [admin, storekeeper] = await User.create([
    {
      name: 'Master Data Admin',
      email: 'master-admin@example.com',
      passwordHash: 'unused',
      roleIds: [adminRole._id],
    },
    {
      name: 'Stock Keeper',
      email: 'master-store@example.com',
      passwordHash: 'unused',
      roleIds: [storeRole._id],
    },
  ]);
  if (!admin || !storekeeper) throw new Error('Users were not created');
  adminId = admin._id;
  adminToken = token(admin._id);
  storekeeperToken = token(storekeeper._id);
});

describe('inventory item and location management', () => {
  it('creates all six item types with validated base-unit conversions and replenishment data', async () => {
    for (const type of [
      'RAW_MATERIAL',
      'COMPONENT',
      'FINISHED_GOOD',
      'TRADING_GOOD',
      'CONSUMABLE',
      'SERVICE',
    ]) {
      const created = await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', adminToken)
        .send({
          sku: `UNIT-${type}`,
          name: `Unit ${type}`,
          type,
          baseUnit: 'PCS',
          description: 'Master-data fixture',
          unitConversions: [{ unit: 'SET', baseQuantity: '2.5' }],
          reorderLevel: '0',
          reorderQty: '4.5',
          leadTimeDays: 7,
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        type,
        description: 'Master-data fixture',
        unitConversions: [{ unit: 'SET', baseQuantity: '2.5' }],
        reorderLevel: '0',
        reorderQty: '4.5',
        leadTimeDays: 7,
      });
    }
    for (const unitConversions of [
      [{ unit: 'PCS', baseQuantity: '2' }],
      [{ unit: 'SET', baseQuantity: '0' }],
      [
        { unit: 'SET', baseQuantity: '2' },
        { unit: 'set', baseQuantity: '3' },
      ],
    ]) {
      await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', adminToken)
        .send({
          sku: `INVALID-${randomUUID()}`,
          name: 'Invalid conversion',
          type: 'TRADING_GOOD',
          baseUnit: 'PCS',
          unitConversions,
        })
        .expect(400);
    }
    const existing = await Item.findOne({ sku: 'UNIT-RAW_MATERIAL' }).lean();
    if (!existing) throw new Error('Item fixture was not created');
    await request(app)
      .patch(`/api/v1/inventory/items/${existing._id}`)
      .set('Authorization', adminToken)
      .send({ baseUnit: 'SET' })
      .expect(400);
    const cleared = await request(app)
      .patch(`/api/v1/inventory/items/${existing._id}`)
      .set('Authorization', adminToken)
      .send({ reorderLevel: null, reorderQty: null, leadTimeDays: null })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      reorderLevel: null,
      reorderQty: null,
      leadTimeDays: null,
    });
  });

  it('creates, searches and updates audited master data without weakening Stockkeeper permissions', async () => {
    const item = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', adminToken)
      .send({ sku: ' cue-01 ', name: 'Pool cue', type: 'TRADING_GOOD', baseUnit: 'pcs' })
      .expect(201);
    expect(item.body.data).toMatchObject({
      sku: 'CUE-01',
      baseUnit: 'PCS',
      trackSerial: false,
      isActive: true,
    });
    const location = await request(app)
      .post('/api/v1/inventory/locations')
      .set('Authorization', adminToken)
      .send({ code: ' main-wh ', name: 'Main warehouse', type: 'WAREHOUSE' })
      .expect(201);
    expect(location.body.data.code).toBe('MAIN-WH');
    const itemId = item.body.data.id as string;
    const locationId = location.body.data.id as string;
    const itemSearch = await request(app)
      .get('/api/v1/inventory/items?q=CUE&status=active')
      .set('Authorization', storekeeperToken)
      .expect(200);
    expect(itemSearch.body.data.map((entry: { id: string }) => entry.id)).toEqual([itemId]);
    const locationSearch = await request(app)
      .get('/api/v1/inventory/locations?q=warehouse')
      .set('Authorization', storekeeperToken)
      .expect(200);
    expect(locationSearch.body.data.map((entry: { id: string }) => entry.id)).toEqual([locationId]);
    await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', storekeeperToken)
      .send({ sku: 'DENIED', name: 'Denied item', type: 'TRADING_GOOD', baseUnit: 'PCS' })
      .expect(403);
    await request(app)
      .patch(`/api/v1/inventory/locations/${locationId}`)
      .set('Authorization', storekeeperToken)
      .send({ name: 'Denied edit' })
      .expect(403);
    const updated = await request(app)
      .patch(`/api/v1/inventory/items/${itemId}`)
      .set('Authorization', adminToken)
      .send({ name: 'Premium pool cue' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      sku: 'CUE-01',
      name: 'Premium pool cue',
      trackSerial: false,
    });
    expect(
      (
        await AuditLog.find({ entityType: { $in: ['item', 'location'] } })
          .sort({ at: 1 })
          .lean()
      ).map((entry) => entry.action),
    ).toEqual(['item.create', 'location.create', 'item.update']);
  });

  it('rejects duplicate identities and malformed or empty updates', async () => {
    const input = { sku: 'DUP-1', name: 'First item', type: 'COMPONENT', baseUnit: 'PCS' };
    const created = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', adminToken)
      .send(input)
      .expect(201);
    await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', adminToken)
      .send(input)
      .expect(409);
    await request(app)
      .patch(`/api/v1/inventory/items/${created.body.data.id}`)
      .set('Authorization', adminToken)
      .send({})
      .expect(400);
    await request(app)
      .post('/api/v1/inventory/locations')
      .set('Authorization', adminToken)
      .send({ code: 'BAD', name: 'Wrong', type: 'NOT_A_LOCATION' })
      .expect(400);
  });

  it('paginates items and allows deactivation only before any stock movement', async () => {
    const first = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', adminToken)
      .send({
        sku: 'PAGE-1',
        name: 'First item',
        type: 'TRADING_GOOD',
        baseUnit: 'PCS',
        trackSerial: true,
      })
      .expect(201);
    const second = await request(app)
      .post('/api/v1/inventory/items')
      .set('Authorization', adminToken)
      .send({ sku: 'PAGE-2', name: 'Second item', type: 'TRADING_GOOD', baseUnit: 'PCS' })
      .expect(201);
    const newest = await request(app)
      .get('/api/v1/inventory/items?limit=1')
      .set('Authorization', storekeeperToken)
      .expect(200);
    expect(newest.body.data.map((record: { id: string }) => record.id)).toEqual([
      second.body.data.id,
    ]);
    const older = await request(app)
      .get(`/api/v1/inventory/items?limit=1&before=${second.body.data.id}`)
      .set('Authorization', storekeeperToken)
      .expect(200);
    expect(older.body.data.map((record: { id: string }) => record.id)).toEqual([
      first.body.data.id,
    ]);
    const inactive = await request(app)
      .patch(`/api/v1/inventory/items/${first.body.data.id}`)
      .set('Authorization', adminToken)
      .send({ isActive: false })
      .expect(200);
    expect(inactive.body.data).toMatchObject({ isActive: false, trackSerial: true });
    const filtered = await request(app)
      .get('/api/v1/inventory/items?status=inactive')
      .set('Authorization', storekeeperToken)
      .expect(200);
    expect(filtered.body.data.map((record: { id: string }) => record.id)).toEqual([
      first.body.data.id,
    ]);
    await request(app)
      .get('/api/v1/inventory/items')
      .set(
        'Authorization',
        token(
          (
            await User.create({
              name: 'No Access',
              email: 'no-access@example.com',
              passwordHash: 'unused',
              roleIds: [],
            })
          )._id,
        ),
      )
      .expect(403);
  });

  it('protects stocked identities while allowing descriptive edits', async () => {
    const item = await Item.create({
      sku: 'STOCKED-1',
      name: 'Stocked item',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    });
    const location = await Location.create({
      code: 'STOCKED-WH',
      name: 'Stocked warehouse',
      type: 'WAREHOUSE',
    });
    await postIn({
      itemId: item._id,
      locationId: location._id,
      quantity: '1',
      unitCost: 125,
      movementType: 'OPENING',
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'TEST-1' },
      postedBy: adminId,
      idempotencyKey: randomUUID(),
    });
    for (const change of [
      { sku: 'CHANGED' },
      { type: 'SERVICE' },
      { baseUnit: 'KG' },
      { trackSerial: true },
      { unitConversions: [{ unit: 'ROLL', baseQuantity: '25' }] },
      { isActive: false },
    ]) {
      await request(app)
        .patch(`/api/v1/inventory/items/${item._id}`)
        .set('Authorization', adminToken)
        .send(change)
        .expect(409);
    }
    for (const change of [{ code: 'CHANGED' }, { type: 'SHOWROOM' }, { isActive: false }]) {
      await request(app)
        .patch(`/api/v1/inventory/locations/${location._id}`)
        .set('Authorization', adminToken)
        .send(change)
        .expect(409);
    }
    await request(app)
      .patch(`/api/v1/inventory/locations/${location._id}`)
      .set('Authorization', adminToken)
      .send({ name: 'Updated warehouse' })
      .expect(200);
    const descriptive = await request(app)
      .patch(`/api/v1/inventory/items/${item._id}`)
      .set('Authorization', adminToken)
      .send({ description: 'Updated after stock', reorderLevel: '0', leadTimeDays: 5 })
      .expect(200);
    expect(descriptive.body.data).toMatchObject({
      description: 'Updated after stock',
      reorderLevel: '0',
      leadTimeDays: 5,
    });
    expect(
      (await StockBalance.findOne({ itemId: item._id, locationId: location._id }))?.value,
    ).toBe(125);
  });

  it('prevents a stale first-use deactivation from committing alongside stock', async () => {
    const item = await Item.create({
      sku: 'FIRST-USE',
      name: 'First use',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    });
    const location = await Location.create({
      code: 'FIRST-WH',
      name: 'First warehouse',
      type: 'WAREHOUSE',
    });
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const stale = await Item.findById(item._id).session(session);
      expect(stale).not.toBeNull();
      expect(await StockMovement.exists({ itemId: item._id }).session(session)).toBeNull();
      await postIn({
        itemId: item._id,
        locationId: location._id,
        quantity: '1',
        unitCost: 50,
        movementType: 'OPENING',
        sourceDoc: { type: 'TEST', id: randomUUID(), number: 'FIRST-1' },
        postedBy: adminId,
        idempotencyKey: randomUUID(),
      });
      if (!stale) throw new Error('Item missing');
      stale.isActive = false;
      await expect(stale.save({ session })).rejects.toThrow();
      await session.abortTransaction();
      expect((await Item.findById(item._id))?.isActive).toBe(true);
      expect(await StockMovement.countDocuments({ itemId: item._id })).toBe(1);
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });

  it('rolls back a first inbound posting when its item lifecycle lock cannot be acquired', async () => {
    const item = await Item.create({
      sku: 'LOCK-FAIL',
      name: 'Lock failure',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    });
    const location = await Location.create({
      code: 'LOCK-WH',
      name: 'Lock warehouse',
      type: 'WAREHOUSE',
    });
    const lockFailure = vi
      .spyOn(Item, 'updateOne')
      .mockResolvedValueOnce({ matchedCount: 0 } as never);
    try {
      await expect(
        postIn({
          itemId: item._id,
          locationId: location._id,
          quantity: '1',
          unitCost: 50,
          movementType: 'OPENING',
          sourceDoc: { type: 'TEST', id: randomUUID(), number: 'LOCK-1' },
          postedBy: adminId,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      lockFailure.mockRestore();
    }
    expect(await StockMovement.countDocuments({ itemId: item._id })).toBe(0);
  });

  it('rolls back item creation when its audit record fails', async () => {
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      await request(app)
        .post('/api/v1/inventory/items')
        .set('Authorization', adminToken)
        .send({ sku: 'ROLLBACK', name: 'Rollback item', type: 'TRADING_GOOD', baseUnit: 'PCS' })
        .expect(500);
    } finally {
      auditFailure.mockRestore();
    }
    expect(await Item.countDocuments({ sku: 'ROLLBACK' })).toBe(0);
  });
});
