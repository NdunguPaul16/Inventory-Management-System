import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';
import { Counter } from '../src/modules/counters/model.js';
import { StockCount } from '../src/modules/inventory/count-model.js';
import {
  approveStockCount,
  enterSerialStockCount,
  enterStockCount,
  freezeStockCount,
  listStockCounts,
  postStockCount,
  rejectStockCount,
} from '../src/modules/inventory/count-service.js';
import {
  CostLayer,
  PostingRequest,
  SerialNumber,
  StockBalance,
  StockMovement,
} from '../src/modules/inventory/engine/models.js';
import { postIn, postOut, reconcileBalances } from '../src/modules/inventory/engine/service.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
const storekeeper = new Types.ObjectId();
const manager = new Types.ObjectId();
let itemId: Types.ObjectId;
let locationId: Types.ObjectId;

beforeAll(async () => {
  await Promise.all([
    AuditLog.createCollection(),
    Counter.createCollection(),
    StockCount.createCollection(),
    Item.createCollection(),
    Location.createCollection(),
    StockBalance.createCollection(),
    StockMovement.createCollection(),
    CostLayer.createCollection(),
    PostingRequest.createCollection(),
    SerialNumber.createCollection(),
    Role.createCollection(),
    User.createCollection(),
  ]);
  await Promise.all([
    StockCount.syncIndexes(),
    StockBalance.syncIndexes(),
    StockMovement.syncIndexes(),
    CostLayer.syncIndexes(),
    PostingRequest.syncIndexes(),
    SerialNumber.syncIndexes(),
    Role.syncIndexes(),
    User.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}),
    Counter.deleteMany({}),
    StockCount.deleteMany({}),
    Item.deleteMany({}),
    Location.deleteMany({}),
    StockBalance.deleteMany({}),
    StockMovement.deleteMany({}),
    CostLayer.deleteMany({}),
    PostingRequest.deleteMany({}),
    SerialNumber.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
  ]);
  const item = await Item.create({
    sku: `COUNT-${randomUUID().slice(0, 8)}`,
    name: 'Counted item',
    type: 'TRADING_GOOD',
    baseUnit: 'PCS',
  });
  const location = await Location.create({
    code: `COUNT-${randomUUID().slice(0, 8)}`,
    name: 'Count location',
    type: 'WAREHOUSE',
  });
  itemId = item._id;
  locationId = location._id;
});

async function receive(quantity: string, unitCost = 101) {
  return postIn({
    itemId,
    locationId,
    quantity,
    unitCost,
    movementType: 'OPENING',
    sourceDoc: { type: 'TEST', id: randomUUID(), number: 'TEST-1' },
    postedBy: manager,
    idempotencyKey: `test:${randomUUID()}`,
  });
}

async function frozen() {
  return freezeStockCount(
    { itemId: String(itemId), locationId: String(locationId) },
    String(storekeeper),
  );
}

async function submitted(countId: string, countedQuantity: string, inboundUnitCost?: number) {
  await enterStockCount(
    countId,
    {
      countedQuantity,
      reason: 'Physical count variance',
      ...(inboundUnitCost === undefined ? {} : { inboundUnitCost }),
    },
    String(storekeeper),
  );
  await approveStockCount(countId, String(manager));
}

describe('stock counts', () => {
  it('filters count history and pages backward without repeating a record', async () => {
    const first = await frozen();
    await rejectStockCount(first.id, String(manager), 'Repeat the count');
    const second = await frozen();
    await rejectStockCount(second.id, String(manager), 'Repeat again');
    const third = await frozen();
    const latest = await listStockCounts({ limit: 1 });
    expect(latest.map((record) => record.id)).toEqual([third.id]);
    expect(latest[0]?.item).toMatchObject({ name: 'Counted item' });
    const next = await listStockCounts({ limit: 1, before: third.id });
    expect(next.map((record) => record.id)).toEqual([second.id]);
    expect(
      (await listStockCounts({ limit: 10, status: 'REJECTED' })).map((record) => record.id),
    ).toEqual([second.id, first.id]);
  });

  it('offers active stock references including serial items to authorised counters', async () => {
    const storeRole = await Role.create(DEFAULT_ROLES.find((role) => role.name === 'Storekeeper')!);
    await User.create({
      _id: storekeeper,
      name: 'Store Keeper',
      email: 'store@example.com',
      passwordHash: 'unused',
      roleIds: [storeRole._id],
    });
    await Item.create({
      sku: 'COUNT-SERIAL',
      name: 'Serial item',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
      trackSerial: true,
    });
    await Item.create({
      sku: 'COUNT-SERVICE',
      name: 'Service item',
      type: 'SERVICE',
      baseUnit: 'PCS',
    });
    await Location.create({
      code: 'COUNT-INACTIVE',
      name: 'Closed location',
      type: 'WAREHOUSE',
      isActive: false,
    });
    const secret = 'test-access-token-secret-that-is-at-least-32-characters';
    const token = jwt.sign({ type: 'access' }, secret, {
      subject: String(storekeeper),
      expiresIn: 60,
    });
    const items = await request(app)
      .get('/api/v1/inventory/counts/options/items?q=COUNT-')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(items.body.data).toHaveLength(2);
    expect(
      items.body.data.map((item: { trackSerial: boolean }) => item.trackSerial).sort(),
    ).toEqual([false, true]);
    const stockItems = await request(app)
      .get('/api/v1/inventory/options/items?q=COUNT-')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      stockItems.body.data.map((item: { trackSerial: boolean }) => item.trackSerial).sort(),
    ).toEqual([false, true]);
    const locations = await request(app)
      .get('/api/v1/inventory/counts/options/locations?q=COUNT-')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(locations.body.data).toHaveLength(1);
    expect(locations.body.data[0]).toMatchObject({
      id: String(locationId),
      name: 'Count location',
    });
    await request(app)
      .get('/api/v1/inventory/options/locations?q=COUNT-')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .then((response) => expect(response.body.data).toHaveLength(1));
    await request(app)
      .get('/api/v1/inventory/counts/options/items?q=%5B')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v1/inventory/counts/options/items').expect(401);
    await request(app).get('/api/v1/inventory/options/items').expect(401);
    await request(app)
      .get(`/api/v1/inventory/options/items?q=${'x'.repeat(101)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const unrelatedRole = await Role.create({
      name: 'Unrelated reader',
      permissions: ['dashboard.read'],
      isSystem: false,
    });
    const unrelatedUser = await User.create({
      name: 'Other Reader',
      email: 'other-reader@example.com',
      passwordHash: 'unused',
      roleIds: [unrelatedRole._id],
    });
    const unrelatedToken = jwt.sign({ type: 'access' }, secret, {
      subject: String(unrelatedUser._id),
      expiresIn: 60,
    });
    await request(app)
      .get('/api/v1/inventory/options/items')
      .set('Authorization', `Bearer ${unrelatedToken}`)
      .expect(403);
    const transferRole = await Role.create({
      name: 'Transfer only',
      permissions: ['inventory.transfers.post'],
      isSystem: false,
    });
    const transferUser = await User.create({
      name: 'Transfer Clerk',
      email: 'transfer-clerk@example.com',
      passwordHash: 'unused',
      roleIds: [transferRole._id],
    });
    const transferToken = jwt.sign({ type: 'access' }, secret, {
      subject: String(transferUser._id),
      expiresIn: 60,
    });
    await request(app)
      .get('/api/v1/inventory/options/items')
      .set('Authorization', `Bearer ${transferToken}`)
      .expect(200);
    await request(app)
      .get('/api/v1/inventory/counts/options/items')
      .set('Authorization', `Bearer ${transferToken}`)
      .expect(403);
  });

  it('returns balance, FIFO layer and movement details for the frontend', async () => {
    await receive('2.5', 5000);
    const managerRole = await Role.create(
      DEFAULT_ROLES.find((role) => role.name === 'Owner / Manager')!,
    );
    await User.create({
      _id: manager,
      name: 'Owner Manager',
      email: 'manager@example.com',
      passwordHash: 'unused',
      roleIds: [managerRole._id],
    });
    const secret = 'test-access-token-secret-that-is-at-least-32-characters';
    const token = jwt.sign({ type: 'access' }, secret, {
      subject: String(manager),
      expiresIn: 60,
    });
    const response = await request(app)
      .get('/api/v1/inventory/balances')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      itemId: { sku: expect.stringMatching(/^COUNT-/), name: 'Counted item', baseUnit: 'PCS' },
      locationId: { name: 'Count location', type: 'WAREHOUSE' },
      onHand: { $numberDecimal: '2.5' },
      reserved: { $numberDecimal: '0' },
      value: 12_500,
    });
    const layers = await request(app)
      .get(`/api/v1/inventory/items/${itemId}/layers?locationId=${locationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(layers.body.data[0]).toMatchObject({
      originalQty: { $numberDecimal: '2.5' },
      remainingQty: { $numberDecimal: '2.5' },
      remainingValue: 12_500,
      sourceDoc: { number: 'TEST-1' },
    });
    const movements = await request(app)
      .get(`/api/v1/inventory/items/${itemId}/movements?locationId=${locationId}&limit=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(movements.body.data[0]).toMatchObject({
      direction: 'IN',
      quantity: { $numberDecimal: '2.5' },
      totalCost: 12_500,
      sourceDoc: { number: 'TEST-1' },
    });
    const balanceOnlyRole = await Role.create({
      name: 'Balance only',
      permissions: ['inventory.balances.read'],
      isSystem: false,
    });
    const balanceOnlyUser = await User.create({
      name: 'Balance Reader',
      email: 'balance-reader@example.com',
      passwordHash: 'unused',
      roleIds: [balanceOnlyRole._id],
    });
    const restrictedToken = jwt.sign({ type: 'access' }, secret, {
      subject: String(balanceOnlyUser._id),
      expiresIn: 60,
    });
    await request(app)
      .get(`/api/v1/inventory/items/${itemId}/layers?locationId=${locationId}`)
      .set('Authorization', `Bearer ${restrictedToken}`)
      .expect(403);
    await request(app)
      .get(`/api/v1/inventory/items/${itemId}/movements?locationId=${locationId}`)
      .set('Authorization', `Bearer ${restrictedToken}`)
      .expect(403);
  });

  it('posts an approved positive variance through the FIFO engine and audits the workflow', async () => {
    await receive('2', 101);
    const count = await frozen();
    expect(count.bookQuantity).toBe('2');
    await submitted(count.id, '2.5', 137);
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.status).toBe('POSTED');
    expect(posted.varianceQuantity).toBe('0.5');
    expect(posted.movementIds).toHaveLength(1);
    expect(await postStockCount(count.id, String(manager))).toEqual(posted);
    const movement = await StockMovement.findById(posted.movementIds[0]);
    expect(movement?.movementType).toBe('COUNT_VARIANCE');
    expect(movement?.direction).toBe('IN');
    expect(movement?.totalCost).toBe(69);
    expect((await StockBalance.findOne({ itemId, locationId }))?.onHand.toString()).toBe('2.5');
    expect((await reconcileBalances()).differences).toEqual([]);
    expect(await AuditLog.countDocuments({ entityType: 'stock_count' })).toBe(4);
    expect((await frozen()).status).toBe('FROZEN');
  });

  it('posts an approved shortage at original FIFO cost', async () => {
    await receive('1', 260);
    await receive('1', 280);
    const count = await frozen();
    await submitted(count.id, '1.5');
    const posted = await postStockCount(count.id, String(manager));
    const movement = await StockMovement.findById(posted.movementIds[0]);
    expect(movement?.direction).toBe('OUT');
    expect(movement?.totalCost).toBe(130);
    expect(movement?.layersConsumed?.[0]?.quantity.toString()).toBe('0.5');
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('records an unchanged count without creating a movement and prevents double posting', async () => {
    await receive('3');
    const count = await frozen();
    await submitted(count.id, '3');
    const before = await StockMovement.countDocuments();
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.movementIds).toEqual([]);
    expect(await StockMovement.countDocuments()).toBe(before);
    expect((await StockBalance.findOne({ itemId, locationId }))?.version).toBe(
      count.bookVersion + 1,
    );
    expect(await postStockCount(count.id, String(manager))).toEqual(posted);
  });

  it('completes a zero count for an item and location with no prior balance', async () => {
    const count = await frozen();
    expect(count.bookQuantity).toBe('0');
    expect(count.bookVersion).toBe(0);
    await submitted(count.id, '0');
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.status).toBe('POSTED');
    expect(posted.movementIds).toEqual([]);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await StockBalance.findOne({ itemId, locationId })).toMatchObject({
      version: 1,
      value: 0,
    });
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('rejects a stale count without a partial variance posting', async () => {
    await receive('2');
    const count = await frozen();
    await submitted(count.id, '1');
    await receive('1');
    const before = await StockMovement.countDocuments();
    await expect(postStockCount(count.id, String(manager))).rejects.toThrow('Stock changed');
    expect(await StockMovement.countDocuments()).toBe(before);
    expect((await StockCount.findById(count.id))?.status).toBe('APPROVED');
  });

  it('requires a separate approver and releases the active slot after rejection', async () => {
    const count = await frozen();
    await expect(frozen()).rejects.toThrow('active count');
    await enterStockCount(
      count.id,
      { countedQuantity: '0', reason: 'Shelf is empty' },
      String(storekeeper),
    );
    await expect(approveStockCount(count.id, String(storekeeper))).rejects.toThrow('different');
    const rejected = await rejectStockCount(count.id, String(manager), 'Count must be repeated');
    expect(rejected.status).toBe('REJECTED');
    expect((await frozen()).status).toBe('FROZEN');
  });

  it('can cancel an abandoned frozen count so another count may start', async () => {
    const count = await frozen();
    await rejectStockCount(count.id, String(manager), 'Count not completed');
    expect((await frozen()).status).toBe('FROZEN');
  });

  it('rolls back a count freeze when its audit event cannot be written', async () => {
    const failure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      await expect(frozen()).rejects.toThrow('Audit unavailable');
      expect(await StockCount.countDocuments()).toBe(0);
    } finally {
      failure.mockRestore();
    }
  });

  it('requires an inbound cost for a numeric surplus', async () => {
    const count = await frozen();
    await expect(
      enterStockCount(
        count.id,
        { countedQuantity: '1', reason: 'Extra item' },
        String(storekeeper),
      ),
    ).rejects.toThrow('Inbound unit cost');
  });

  it('posts a same-quantity serial swap as atomic OUT and IN movements', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    await postIn({
      itemId,
      locationId,
      quantity: '2',
      unitCost: 101,
      movementType: 'OPENING',
      serialNumbers: ['ALPHA', 'BRAVO'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'TEST-SERIAL' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    const count = await frozen();
    expect(count).toMatchObject({
      mode: 'SERIAL',
      bookSerialNumbers: ['ALPHA', 'BRAVO'],
      bookQuantity: '2',
    });
    await expect(
      enterStockCount(
        count.id,
        { countedQuantity: '2', reason: 'Serial swap' },
        String(storekeeper),
      ),
    ).rejects.toThrow('serial entry');
    await enterSerialStockCount(
      count.id,
      {
        serialNumbers: ['bravo', 'charlie'],
        inboundUnitCost: 137,
        reason: 'Physical serial count',
      },
      String(storekeeper),
    );
    await approveStockCount(count.id, String(manager));
    const posted = await postStockCount(count.id, String(manager));
    expect(posted).toMatchObject({
      status: 'POSTED',
      countedQuantity: '2',
      varianceQuantity: '0',
      countedSerialNumbers: ['BRAVO', 'CHARLIE'],
    });
    expect(posted.movementIds).toHaveLength(2);
    expect(
      (
        await StockMovement.find({ _id: { $in: posted.movementIds } }).sort({ postedAt: 1, _id: 1 })
      ).map((movement) => movement.direction),
    ).toEqual(['OUT', 'IN']);
    expect(
      (await SerialNumber.find({ itemId }).sort({ serialNo: 1 })).map((serial) => [
        serial.serialNo,
        serial.status,
      ]),
    ).toEqual([
      ['ALPHA', 'ISSUED'],
      ['BRAVO', 'IN_STOCK'],
      ['CHARLIE', 'IN_STOCK'],
    ]);
    expect((await StockBalance.findOne({ itemId, locationId }))?.value).toBe(238);
    expect((await reconcileBalances()).differences).toEqual([]);
    expect(await postStockCount(count.id, String(manager))).toEqual(posted);
  });

  it('rejects a duplicate serial entry without changing the frozen count', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    const count = await frozen();
    await expect(
      enterSerialStockCount(
        count.id,
        {
          serialNumbers: ['same', 'SAME'],
          inboundUnitCost: 100,
          reason: 'Duplicate physical label',
        },
        String(storekeeper),
      ),
    ).rejects.toThrow('unique');
    expect((await StockCount.findById(count.id))?.status).toBe('FROZEN');
  });

  it('posts an unchanged serial set without a movement', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    const count = await frozen();
    expect(count.bookSerialNumbers).toEqual([]);
    await enterSerialStockCount(
      count.id,
      { serialNumbers: [], reason: 'Empty shelf confirmed' },
      String(storekeeper),
    );
    await approveStockCount(count.id, String(manager));
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.movementIds).toEqual([]);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect((await StockBalance.findOne({ itemId, locationId }))?.version).toBe(1);
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('posts a missing serial at recorded FIFO cost', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    await postIn({
      itemId,
      locationId,
      quantity: '2',
      unitCost: 125,
      movementType: 'OPENING',
      serialNumbers: ['FOUND', 'MISSING'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'SERIAL-OPEN' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    const count = await frozen();
    await enterSerialStockCount(
      count.id,
      { serialNumbers: ['FOUND'], reason: 'One label missing' },
      String(storekeeper),
    );
    await approveStockCount(count.id, String(manager));
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.movementIds).toHaveLength(1);
    const movement = await StockMovement.findById(posted.movementIds[0]);
    expect(movement).toMatchObject({ direction: 'OUT', totalCost: 125 });
    expect((await StockBalance.findOne({ itemId, locationId }))?.value).toBe(125);
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('posts a missing serial with one returned and one new serial in one transaction', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    await postIn({
      itemId,
      locationId,
      quantity: '3',
      unitCost: 100,
      movementType: 'OPENING',
      serialNumbers: ['KEEP', 'MISSING', 'RETURNED'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'SERIAL-OPEN' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    await postOut({
      itemId,
      locationId,
      quantity: '1',
      movementType: 'SALE',
      serialNumbers: ['RETURNED'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'SERIAL-OUT' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    const count = await frozen();
    expect(count.bookSerialNumbers).toEqual(['KEEP', 'MISSING']);
    await enterSerialStockCount(
      count.id,
      {
        serialNumbers: ['KEEP', 'RETURNED', 'NEW'],
        inboundUnitCost: 150,
        reason: 'Physical serial review',
      },
      String(storekeeper),
    );
    await approveStockCount(count.id, String(manager));
    const posted = await postStockCount(count.id, String(manager));
    expect(posted.movementIds).toHaveLength(3);
    expect(
      (await StockMovement.find({ _id: { $in: posted.movementIds } }))
        .map((movement) => movement.direction)
        .sort(),
    ).toEqual(['IN', 'IN', 'OUT']);
    expect(
      (await SerialNumber.find({ itemId, status: 'IN_STOCK' }).sort({ serialNo: 1 })).map(
        (serial) => serial.serialNo,
      ),
    ).toEqual(['KEEP', 'NEW', 'RETURNED']);
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('rejects a found serial already stocked elsewhere without a partial posting', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    await postIn({
      itemId,
      locationId,
      quantity: '1',
      unitCost: 125,
      movementType: 'OPENING',
      serialNumbers: ['LOCAL'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'LOCAL-SERIAL' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    const otherLocation = await Location.create({
      code: 'SERIAL-OTHER',
      name: 'Other location',
      type: 'WAREHOUSE',
    });
    await postIn({
      itemId,
      locationId: otherLocation._id,
      quantity: '1',
      unitCost: 100,
      movementType: 'OPENING',
      serialNumbers: ['ELSEWHERE'],
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'OTHER-SERIAL' },
      postedBy: manager,
      idempotencyKey: `test:${randomUUID()}`,
    });
    const count = await frozen();
    await enterSerialStockCount(
      count.id,
      {
        serialNumbers: ['ELSEWHERE'],
        inboundUnitCost: 100,
        reason: 'Unexpected found serial',
      },
      String(storekeeper),
    );
    await approveStockCount(count.id, String(manager));
    const movementCount = await StockMovement.countDocuments();
    await expect(postStockCount(count.id, String(manager))).rejects.toThrow('already exist');
    expect(await StockMovement.countDocuments()).toBe(movementCount);
    expect((await StockCount.findById(count.id))?.status).toBe('APPROVED');
    expect((await SerialNumber.findOne({ serialNo: 'LOCAL' }))?.status).toBe('IN_STOCK');
    expect((await StockBalance.findOne({ itemId, locationId }))?.value).toBe(125);
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('enforces count approval and posting permissions at the API', async () => {
    const storeRole = await Role.create(DEFAULT_ROLES.find((role) => role.name === 'Storekeeper')!);
    const managerRole = await Role.create(
      DEFAULT_ROLES.find((role) => role.name === 'Owner / Manager')!,
    );
    await User.create([
      {
        _id: storekeeper,
        name: 'Store Keeper',
        email: 'store@example.com',
        passwordHash: 'unused',
        roleIds: [storeRole._id],
      },
      {
        _id: manager,
        name: 'Owner Manager',
        email: 'manager@example.com',
        passwordHash: 'unused',
        roleIds: [managerRole._id],
      },
    ]);
    const secret = 'test-access-token-secret-that-is-at-least-32-characters';
    const token = (id: Types.ObjectId) =>
      jwt.sign({ type: 'access' }, secret, { subject: String(id), expiresIn: 60 });
    const count = await request(app)
      .post('/api/v1/inventory/counts')
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .send({ itemId: String(itemId), locationId: String(locationId) })
      .expect(201);
    const countId = count.body.data.id as string;
    await request(app)
      .post(`/api/v1/inventory/counts/${countId}/approve`)
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .expect(403);
    const readOnlyRole = await Role.create({
      name: 'Count reader',
      permissions: ['inventory.counts.read'],
      isSystem: false,
    });
    const readOnlyUser = await User.create({
      name: 'Count Reader',
      email: 'count-reader@example.com',
      passwordHash: 'unused',
      roleIds: [readOnlyRole._id],
    });
    for (const targetId of [countId, String(new Types.ObjectId())]) {
      await request(app)
        .patch(`/api/v1/inventory/counts/${targetId}/serial-entry`)
        .set('Authorization', `Bearer ${token(readOnlyUser._id)}`)
        .send({ serialNumbers: [], reason: 'Not authorised' })
        .expect(403);
    }
    await request(app)
      .post(`/api/v1/inventory/counts/${new Types.ObjectId()}/approve`)
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .expect(403);
    await request(app)
      .post(`/api/v1/inventory/counts/${countId}/post`)
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .expect(403);
    await request(app)
      .patch(`/api/v1/inventory/counts/${countId}/entry`)
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .send({ countedQuantity: '0', reason: 'Shelf is empty' })
      .expect(200);
    const customRole = await Role.create({
      name: 'Custom count approver',
      permissions: ['inventory.counts.approve', 'inventory.counts.post'],
      isSystem: false,
    });
    const customUser = await User.create({
      name: 'Custom Approver',
      email: 'custom-count-approver@example.com',
      passwordHash: 'unused',
      roleIds: [customRole._id],
    });
    for (const operation of ['approve', 'reject', 'post'] as const) {
      const call = (targetId: string) =>
        request(app)
          .post(`/api/v1/inventory/counts/${targetId}/${operation}`)
          .set('Authorization', `Bearer ${token(customUser._id)}`)
          .send(operation === 'reject' ? { reason: 'Not authorised' } : {});
      const existing = await call(countId).expect(403);
      const missing = await call(String(new Types.ObjectId())).expect(403);
      expect(existing.body).toEqual(missing.body);
    }
    await request(app)
      .post(`/api/v1/inventory/counts/${countId}/approve`)
      .set('Authorization', `Bearer ${token(manager)}`)
      .expect(200);
    const posted = await request(app)
      .post(`/api/v1/inventory/counts/${countId}/post`)
      .set('Authorization', `Bearer ${token(manager)}`)
      .expect(201);
    expect(posted.body.data.status).toBe('POSTED');
    await request(app)
      .get('/api/v1/inventory/counts')
      .set('Authorization', `Bearer ${token(manager)}`)
      .expect(200)
      .then((response) => {
        expect(response.body.data[0]).toMatchObject({
          item: { name: 'Counted item' },
          location: { name: 'Count location' },
        });
      });
  });

  it('limits reconciliation results to authorised roles at the API', async () => {
    const storeRole = await Role.create(DEFAULT_ROLES.find((role) => role.name === 'Storekeeper')!);
    const managerRole = await Role.create(
      DEFAULT_ROLES.find((role) => role.name === 'Owner / Manager')!,
    );
    await User.create([
      {
        _id: storekeeper,
        name: 'Store Keeper',
        email: 'store@example.com',
        passwordHash: 'unused',
        roleIds: [storeRole._id],
      },
      {
        _id: manager,
        name: 'Owner Manager',
        email: 'manager@example.com',
        passwordHash: 'unused',
        roleIds: [managerRole._id],
      },
    ]);
    await receive('2');
    const secret = 'test-access-token-secret-that-is-at-least-32-characters';
    const token = (id: Types.ObjectId) =>
      jwt.sign({ type: 'access' }, secret, { subject: String(id), expiresIn: 60 });
    await request(app).get('/api/v1/inventory/reconciliation').expect(401);
    const denied = await request(app)
      .get('/api/v1/inventory/reconciliation')
      .set('Authorization', `Bearer ${token(storekeeper)}`)
      .expect(403);
    expect(denied.body).not.toHaveProperty('data');
    const allowed = await request(app)
      .get('/api/v1/inventory/reconciliation')
      .set('Authorization', `Bearer ${token(manager)}`)
      .expect(200);
    expect(allowed.body.data).toEqual({ checked: 1, differences: [] });
  });
});
