import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';
import { Counter } from '../src/modules/counters/model.js';
import { StockAction } from '../src/modules/inventory/action-model.js';
import {
  CostLayer,
  PostingRequest,
  StockBalance,
  StockMovement,
} from '../src/modules/inventory/engine/models.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';
import { Role } from '../src/modules/roles/model.js';
import { DEFAULT_ROLES } from '../src/modules/roles/service.js';
import { User } from '../src/modules/users/model.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
let adminId: Types.ObjectId;
let itemId: Types.ObjectId;
let locationId: Types.ObjectId;
let authorization: string;

beforeAll(async () => {
  await Promise.all([
    AuditLog.createCollection(),
    Counter.createCollection(),
    StockAction.createCollection(),
    CostLayer.createCollection(),
    PostingRequest.createCollection(),
    StockBalance.createCollection(),
    StockMovement.createCollection(),
    Item.createCollection(),
    Location.createCollection(),
    Role.createCollection(),
    User.createCollection(),
  ]);
  await Promise.all([
    StockAction.syncIndexes(),
    CostLayer.syncIndexes(),
    PostingRequest.syncIndexes(),
    StockBalance.syncIndexes(),
    StockMovement.syncIndexes(),
    Role.syncIndexes(),
    User.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}),
    Counter.deleteMany({}),
    StockAction.deleteMany({}),
    CostLayer.deleteMany({}),
    PostingRequest.deleteMany({}),
    StockBalance.deleteMany({}),
    StockMovement.deleteMany({}),
    Item.deleteMany({}),
    Location.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
  ]);
  const role = await Role.create(DEFAULT_ROLES.find((entry) => entry.name === 'Admin')!);
  const user = await User.create({
    name: 'Opening stock administrator',
    email: `opening-${randomUUID()}@example.com`,
    passwordHash: 'unused',
    roleIds: [role._id],
  });
  const item = await Item.create({
    sku: `OPEN-${randomUUID().slice(0, 8)}`,
    name: 'Opening test item',
    type: 'TRADING_GOOD',
    baseUnit: 'PCS',
  });
  const location = await Location.create({
    code: `OPEN-${randomUUID().slice(0, 8)}`,
    name: 'Opening test location',
    type: 'WAREHOUSE',
  });
  adminId = user._id;
  itemId = item._id;
  locationId = location._id;
  const token = jwt.sign(
    { type: 'access' },
    'test-access-token-secret-that-is-at-least-32-characters',
    { subject: String(adminId), expiresIn: 60 },
  );
  authorization = `Bearer ${token}`;
});

async function approvedOpening() {
  const created = await request(app)
    .post('/api/v1/inventory/opening-stock')
    .set('Authorization', authorization)
    .send({
      itemId: String(itemId),
      locationId: String(locationId),
      quantity: '0.5',
      unitCost: 101,
      sourceDoc: { type: 'OPENING_SHEET', id: randomUUID(), number: 'INITIAL-1' },
      receivedAt: '2026-01-15T12:00:00.000Z',
    })
    .expect(201);
  expect(created.body.data.status).toBe('PENDING_APPROVAL');
  const actionId = created.body.data.id as string;
  const approved = await request(app)
    .post(`/api/v1/inventory/requests/${actionId}/approve`)
    .set('Authorization', authorization)
    .expect(200);
  expect(approved.body.data.status).toBe('APPROVED');
  return actionId;
}

async function authorizationWithPermissions(granted: string[], systemManager = false) {
  const role = await Role.create({
    name: systemManager ? 'Owner / Manager' : `Restricted-${randomUUID()}`,
    permissions: granted,
    isSystem: systemManager,
  });
  const user = await User.create({
    name: 'Restricted stock user',
    email: `restricted-${randomUUID()}@example.com`,
    passwordHash: 'unused',
    roleIds: [role._id],
  });
  const token = jwt.sign(
    { type: 'access' },
    'test-access-token-secret-that-is-at-least-32-characters',
    { subject: String(user._id), expiresIn: 60 },
  );
  return `Bearer ${token}`;
}

describe('stock request authorization before lookup', () => {
  it.each(['approve', 'reject', 'post'] as const)(
    'denies %s for existing and nonexistent requests without disclosing existence',
    async (operation) => {
      const actionId = await approvedOpening();
      const restricted = await authorizationWithPermissions(['inventory.requests.read']);
      const call = (requestId: string) =>
        request(app)
          .post(`/api/v1/inventory/requests/${requestId}/${operation}`)
          .set('Authorization', restricted)
          .send(operation === 'reject' ? { reason: 'Not authorised' } : {});
      const existing = await call(actionId).expect(403);
      const missing = await call(String(new Types.ObjectId())).expect(403);
      expect(existing.body).toEqual(missing.body);
      expect((await StockAction.findById(actionId))?.status).toBe('APPROVED');
    },
  );

  it.each([
    ['approve', 'inventory.adjustments.approve'],
    ['reject', 'inventory.adjustments.approve'],
    ['post', 'inventory.adjustments.post'],
  ] as const)(
    'hides opening requests from a Manager with only %s permission for adjustments',
    async (operation, permission) => {
      const actionId = await approvedOpening();
      const restricted = await authorizationWithPermissions([permission], true);
      const call = (requestId: string) =>
        request(app)
          .post(`/api/v1/inventory/requests/${requestId}/${operation}`)
          .set('Authorization', restricted)
          .send(operation === 'reject' ? { reason: 'Not authorised' } : {});
      const existing = await call(actionId).expect(404);
      const missing = await call(String(new Types.ObjectId())).expect(404);
      expect(existing.body).toEqual(missing.body);
      expect((await StockAction.findById(actionId))?.status).toBe('APPROVED');
    },
  );

  it.each([
    ['approve', 'inventory.opening.approve'],
    ['approve', '*'],
    ['reject', 'inventory.opening.approve'],
    ['post', 'inventory.opening.post'],
  ] as const)(
    'denies %s to a custom role even with the matching stock permission',
    async (operation, permission) => {
      const actionId = await approvedOpening();
      const customRole = await authorizationWithPermissions([permission]);
      const call = (requestId: string) =>
        request(app)
          .post(`/api/v1/inventory/requests/${requestId}/${operation}`)
          .set('Authorization', customRole)
          .send(operation === 'reject' ? { reason: 'Not authorised' } : {});
      const existing = await call(actionId).expect(403);
      const missing = await call(String(new Types.ObjectId())).expect(403);
      expect(existing.body).toEqual(missing.body);
      expect((await StockAction.findById(actionId))?.status).toBe('APPROVED');
    },
  );
});

describe('opening stock approval and posting', () => {
  it('records a fractional opening, its approval, audits and idempotent posting', async () => {
    const actionId = await approvedOpening();
    const first = await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(first.body.data.request.status).toBe('POSTED');
    expect(first.body.data.posting.replayed).toBe(false);
    expect(first.body.data.posting.movements).toMatchObject([
      { direction: 'IN', quantity: '0.5', totalCost: 51 },
    ]);

    const movement = await StockMovement.findOne({ itemId, locationId }).lean();
    const layer = await CostLayer.findOne({ itemId, locationId }).lean();
    const balance = await StockBalance.findOne({ itemId, locationId }).lean();
    expect(movement?.sourceDoc.type).toBe('STOCK_OPENING');
    expect(layer?.receivedAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(layer?.remainingValue).toBe(51);
    expect(balance?.onHand.toString()).toBe('0.5');
    expect(balance?.value).toBe(51);
    expect(
      (
        await AuditLog.find({ entityType: 'stock_action_request', entityId: actionId })
          .sort({ at: 1, _id: 1 })
          .lean()
      ).map((event) => event.action),
    ).toEqual(['stock.action.request', 'stock.action.approve', 'stock.action.post']);
    expect(
      await AuditLog.countDocuments({
        action: 'stock.action.approve',
        'metadata.bootstrapOverride': 'initial-opening-stock',
      }),
    ).toBe(1);

    const replay = await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(replay.body.data.posting.replayed).toBe(true);
    expect(await StockMovement.countDocuments({ itemId, locationId })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'stock.action.post' })).toBe(1);
  });

  it('rolls back the movement and action status if the posting audit fails', async () => {
    const actionId = await approvedOpening();
    const auditCount = await AuditLog.countDocuments();
    const auditFailure = vi
      .spyOn(AuditLog, 'create')
      .mockRejectedValueOnce(new Error('simulated posting audit failure'));
    try {
      await request(app)
        .post(`/api/v1/inventory/requests/${actionId}/post`)
        .set('Authorization', authorization)
        .expect(500);
    } finally {
      auditFailure.mockRestore();
    }
    expect((await StockAction.findById(actionId))?.status).toBe('APPROVED');
    expect(await StockMovement.countDocuments({ itemId, locationId })).toBe(0);
    expect(await CostLayer.countDocuments({ itemId, locationId })).toBe(0);
    expect(await StockBalance.countDocuments({ itemId, locationId })).toBe(0);
    expect(await PostingRequest.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(auditCount);
  });
});

describe('opening stock batch approval and posting', () => {
  function batchLines(secondItemId = String(itemId)) {
    return [
      {
        lineId: 'sheet-row-2',
        itemId: String(itemId),
        locationId: String(locationId),
        quantity: '0.5',
        unitCost: 101,
        receivedAt: '2026-01-15T12:00:00.000Z',
      },
      {
        lineId: 'sheet-row-3',
        itemId: secondItemId,
        locationId: String(locationId),
        quantity: '2',
        unitCost: 35,
        receivedAt: '2026-01-16T12:00:00.000Z',
      },
    ];
  }

  async function approvedBatch(lines = batchLines()) {
    const created = await request(app)
      .post('/api/v1/inventory/opening-stock/batches')
      .set('Authorization', authorization)
      .send({
        sourceDoc: { type: 'OPENING_SHEET', id: randomUUID(), number: 'INITIAL-BATCH' },
        lines,
      })
      .expect(201);
    expect(created.body.data.actionType).toBe('OPENING_BATCH');
    const actionId = created.body.data.id as string;
    await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/approve`)
      .set('Authorization', authorization)
      .expect(200);
    return actionId;
  }

  it('posts every row atomically with recorded cents and replays without duplicate movements', async () => {
    const actionId = await approvedBatch();
    const posted = await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(posted.body.data.posting.movements).toMatchObject([
      { direction: 'IN', quantity: '0.5', totalCost: 51 },
      { direction: 'IN', quantity: '2', totalCost: 70 },
    ]);
    const movements = await StockMovement.find({ itemId, locationId }).sort({
      'sourceDoc.lineId': 1,
    });
    expect(movements.map((movement) => movement.sourceDoc.lineId)).toEqual([
      'sheet-row-2',
      'sheet-row-3',
    ]);
    expect((await StockBalance.findOne({ itemId, locationId }))?.value).toBe(121);
    expect(await CostLayer.countDocuments({ itemId, locationId })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'stock.action.post' })).toBe(1);

    const replay = await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(replay.body.data.posting.replayed).toBe(true);
    expect(await StockMovement.countDocuments({ itemId, locationId })).toBe(2);
  });

  it('rejects duplicate line IDs and zero quantity before creating a request', async () => {
    const duplicate = batchLines();
    duplicate[1]!.lineId = duplicate[0]!.lineId;
    await request(app)
      .post('/api/v1/inventory/opening-stock/batches')
      .set('Authorization', authorization)
      .send({ sourceDoc: { type: 'SHEET', id: 'sheet-1', number: 'S-1' }, lines: duplicate })
      .expect(400);
    const zero = batchLines();
    zero[1]!.quantity = '0.0';
    await request(app)
      .post('/api/v1/inventory/opening-stock/batches')
      .set('Authorization', authorization)
      .send({ sourceDoc: { type: 'SHEET', id: 'sheet-2', number: 'S-2' }, lines: zero })
      .expect(400);
    expect(await StockAction.countDocuments()).toBe(0);
  });

  it('denies Storekeepers access to batch opening requests', async () => {
    const role = await Role.create(DEFAULT_ROLES.find((entry) => entry.name === 'Storekeeper')!);
    const storekeeper = await User.create({
      name: 'Opening batch restricted user',
      email: `restricted-${randomUUID()}@example.com`,
      passwordHash: 'unused',
      roleIds: [role._id],
    });
    const token = jwt.sign(
      { type: 'access' },
      'test-access-token-secret-that-is-at-least-32-characters',
      { subject: String(storekeeper._id), expiresIn: 60 },
    );
    await request(app)
      .post('/api/v1/inventory/opening-stock/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceDoc: { type: 'SHEET', id: 'sheet-1', number: 'S-1' },
        lines: batchLines(),
      })
      .expect(403);
    expect(await StockAction.countDocuments()).toBe(0);
  });

  it('resolves sheet SKUs and location codes without creating master records', async () => {
    const item = await Item.findById(itemId).orFail();
    const location = await Location.findById(locationId).orFail();
    const created = await request(app)
      .post('/api/v1/inventory/opening-stock/imports')
      .set('Authorization', authorization)
      .send({
        sourceDoc: { type: 'OPENING_IMPORT', id: 'sheet-1', number: 'INITIAL-SHEET' },
        lines: batchLines().map(({ itemId: _itemId, locationId: _locationId, ...line }) => ({
          ...line,
          sku: item.sku.toLowerCase(),
          locationCode: location.code.toLowerCase(),
        })),
      })
      .expect(201);
    expect(created.body.data.payload.lines).toMatchObject([
      {
        itemId: String(itemId),
        locationId: String(locationId),
        lineId: 'sheet-row-2',
        sku: item.sku,
        locationCode: location.code,
      },
      {
        itemId: String(itemId),
        locationId: String(locationId),
        lineId: 'sheet-row-3',
        sku: item.sku,
        locationCode: location.code,
      },
    ]);
    expect(await Item.countDocuments()).toBe(1);
    expect(await Location.countDocuments()).toBe(1);
    expect(await StockMovement.countDocuments()).toBe(0);
    const actionId = created.body.data.id as string;
    await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/approve`)
      .set('Authorization', authorization)
      .expect(200);
    const posted = await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(201);
    expect(
      posted.body.data.posting.movements.map(
        (movement: { totalCost: number }) => movement.totalCost,
      ),
    ).toEqual([51, 70]);
    expect((await StockBalance.findOne({ itemId, locationId }))?.value).toBe(121);
  });

  it('rejects unknown sheet references without leaving a partial request', async () => {
    const location = await Location.findById(locationId).orFail();
    await request(app)
      .post('/api/v1/inventory/opening-stock/imports')
      .set('Authorization', authorization)
      .send({
        sourceDoc: { type: 'OPENING_IMPORT', id: 'sheet-2', number: 'INVALID-SHEET' },
        lines: [
          {
            lineId: 'sheet-row-2',
            sku: 'UNKNOWN-SKU',
            locationCode: location.code,
            quantity: '1',
            unitCost: 10,
          },
        ],
      })
      .expect(400);
    expect(await StockAction.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('checks serial counts and duplicates before a serial import is approved', async () => {
    const item = await Item.findById(itemId).orFail();
    const location = await Location.findById(locationId).orFail();
    item.trackSerial = true;
    await item.save();
    const input = {
      sourceDoc: { type: 'OPENING_IMPORT', id: 'sheet-serial', number: 'SERIAL-SHEET' },
      lines: [
        {
          lineId: 'row-2',
          sku: item.sku,
          locationCode: location.code,
          quantity: '1',
          unitCost: 10,
          serialNumbers: ['S-1'],
        },
        {
          lineId: 'row-3',
          sku: item.sku,
          locationCode: location.code,
          quantity: '1',
          unitCost: 10,
          serialNumbers: ['s-1'],
        },
      ],
    };
    await request(app)
      .post('/api/v1/inventory/opening-stock/imports')
      .set('Authorization', authorization)
      .send(input)
      .expect(400);
    input.lines[1]!.serialNumbers = [];
    await request(app)
      .post('/api/v1/inventory/opening-stock/imports')
      .set('Authorization', authorization)
      .send(input)
      .expect(400);
    expect(await StockAction.countDocuments()).toBe(0);
  });

  it('rolls back all rows when a later row names an inactive or missing item', async () => {
    const actionId = await approvedBatch(batchLines(String(new Types.ObjectId())));
    await request(app)
      .post(`/api/v1/inventory/requests/${actionId}/post`)
      .set('Authorization', authorization)
      .expect(404);
    expect((await StockAction.findById(actionId))?.status).toBe('APPROVED');
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await CostLayer.countDocuments()).toBe(0);
    expect(await StockBalance.countDocuments()).toBe(0);
    expect(await PostingRequest.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'stock.action.post' })).toBe(0);
  });
});
