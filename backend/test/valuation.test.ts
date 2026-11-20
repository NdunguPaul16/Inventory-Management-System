import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Counter } from '../src/modules/counters/model.js';
import {
  CostLayer,
  PostingRequest,
  StockBalance,
  StockMovement,
} from '../src/modules/inventory/engine/models.js';
import {
  postIn,
  postOut,
  reconcileBalances,
  reverse,
  transfer,
} from '../src/modules/inventory/engine/service.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';
import { getStockValuationAsAt } from '../src/modules/inventory/valuation-service.js';
import { Role } from '../src/modules/roles/model.js';
import { User } from '../src/modules/users/model.js';
import { createTestApp } from './helpers.js';

const app = createTestApp();
const actor = new Types.ObjectId();
const T1 = '2026-01-01T12:00:00.000Z';
const T2 = '2026-01-02T12:00:00.000Z';
const T3 = '2026-01-03T12:00:00.000Z';
let itemId: Types.ObjectId;
let sourceId: Types.ObjectId;
let destinationId: Types.ObjectId;

beforeAll(async () => {
  await Promise.all([
    Counter.createCollection(),
    Item.createCollection(),
    Location.createCollection(),
    StockMovement.createCollection(),
    CostLayer.createCollection(),
    StockBalance.createCollection(),
    PostingRequest.createCollection(),
    Role.createCollection(),
    User.createCollection(),
  ]);
  await Promise.all([
    StockMovement.syncIndexes(),
    CostLayer.syncIndexes(),
    StockBalance.syncIndexes(),
    PostingRequest.syncIndexes(),
    Role.syncIndexes(),
    User.syncIndexes(),
  ]);
});

beforeEach(async () => {
  await Promise.all([
    Counter.deleteMany({}),
    Item.deleteMany({}),
    Location.deleteMany({}),
    StockMovement.deleteMany({}),
    CostLayer.deleteMany({}),
    StockBalance.deleteMany({}),
    PostingRequest.deleteMany({}),
    Role.deleteMany({}),
    User.deleteMany({}),
  ]);
  const [item, source, destination] = await Promise.all([
    Item.create({
      sku: `VAL-${randomUUID().slice(0, 8)}`,
      name: 'Valued item',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    }),
    Location.create({ code: `SRC-${randomUUID().slice(0, 8)}`, name: 'Source', type: 'WAREHOUSE' }),
    Location.create({
      code: `DST-${randomUUID().slice(0, 8)}`,
      name: 'Destination',
      type: 'WAREHOUSE',
    }),
  ]);
  itemId = item._id;
  sourceId = source._id;
  destinationId = destination._id;
});

function document() {
  const id = randomUUID();
  return { type: 'TEST', id, number: id };
}

async function dateMovements(ids: string[], at: string) {
  await StockMovement.updateMany(
    { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
    { $set: { postedAt: new Date(at) } },
  );
}

describe('historical stock valuation', () => {
  it('sums recorded fractional costs through FIFO transfer by posting date', async () => {
    const receipt = await postIn({
      itemId,
      locationId: sourceId,
      quantity: '0.5',
      unitCost: 101,
      movementType: 'OPENING',
      sourceDoc: document(),
      postedBy: actor,
      idempotencyKey: randomUUID(),
    });
    await dateMovements(receipt.movementIds, T1);
    const moved = await transfer({
      itemId,
      fromLocationId: sourceId,
      toLocationId: destinationId,
      quantity: '0.1',
      sourceDoc: document(),
      postedBy: actor,
      idempotencyKey: randomUUID(),
    });
    await dateMovements(moved.movementIds, T2);
    expect(await getStockValuationAsAt({ asAt: '2025-12-31T23:59:59.000Z' })).toEqual([]);
    expect(await getStockValuationAsAt({ asAt: T1, itemId: String(itemId) })).toEqual([
      { itemId: String(itemId), locationId: String(sourceId), quantity: '0.5', value: 51 },
    ]);
    const atTransfer = await getStockValuationAsAt({ asAt: T2 });
    expect(atTransfer).toEqual(
      expect.arrayContaining([
        { itemId: String(itemId), locationId: String(sourceId), quantity: '0.4', value: 40 },
        { itemId: String(itemId), locationId: String(destinationId), quantity: '0.1', value: 11 },
      ]),
    );
    expect(atTransfer.reduce((sum, row) => sum + row.value, 0)).toBe(51);
    expect(await getStockValuationAsAt({ asAt: T2, locationId: String(destinationId) })).toEqual([
      { itemId: String(itemId), locationId: String(destinationId), quantity: '0.1', value: 11 },
    ]);
    expect((await reconcileBalances()).differences).toEqual([]);
  });

  it('restores the original recorded cost after an outbound reversal', async () => {
    const receipt = await postIn({
      itemId,
      locationId: sourceId,
      quantity: '0.5',
      unitCost: 101,
      movementType: 'OPENING',
      sourceDoc: document(),
      postedBy: actor,
      idempotencyKey: randomUUID(),
    });
    await dateMovements(receipt.movementIds, T1);
    const issued = await postOut({
      itemId,
      locationId: sourceId,
      quantity: '0.1',
      movementType: 'SALE',
      sourceDoc: document(),
      postedBy: actor,
      idempotencyKey: randomUUID(),
    });
    await dateMovements(issued.movementIds, T2);
    const reversed = await reverse({
      movementId: issued.movementIds[0]!,
      postedBy: actor,
      idempotencyKey: randomUUID(),
    });
    await dateMovements(reversed.movementIds, T3);
    const atIssue = await getStockValuationAsAt({ asAt: T2, itemId: String(itemId) });
    const atReversal = await getStockValuationAsAt({ asAt: T3, itemId: String(itemId) });
    expect(atIssue[0]).toMatchObject({ quantity: '0.4', value: 40 });
    expect(atReversal[0]).toMatchObject({ quantity: '0.5', value: 51 });
    expect(reversed.movements[0]?.totalCost).toBe(issued.movements[0]?.totalCost);
  });

  it('checks valuation permission and validates the UTC cutoff before querying', async () => {
    const [readerRole, valuationRole] = await Role.create([
      { name: 'Balance reader', permissions: ['inventory.balances.read'], isSystem: false },
      { name: 'Valuation reader', permissions: ['inventory.valuation.read'], isSystem: false },
    ]);
    const [reader, valuationUser] = await User.create([
      {
        name: 'Balance Reader',
        email: 'balance@example.com',
        passwordHash: 'unused',
        roleIds: [readerRole!._id],
      },
      {
        name: 'Valuation Reader',
        email: 'valuation@example.com',
        passwordHash: 'unused',
        roleIds: [valuationRole!._id],
      },
    ]);
    const token = (id: Types.ObjectId) =>
      jwt.sign({ type: 'access' }, 'test-access-token-secret-that-is-at-least-32-characters', {
        subject: String(id),
        expiresIn: 60,
      });
    const path = `/api/v1/inventory/valuation?asAt=${encodeURIComponent(T1)}`;
    await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token(reader!._id)}`)
      .expect(403);
    await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token(valuationUser!._id)}`)
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({ data: [], meta: { asAt: T1 } });
      });
    await request(app)
      .get('/api/v1/inventory/valuation?asAt=not-a-date')
      .set('Authorization', `Bearer ${token(valuationUser!._id)}`)
      .expect(400);
  });
});
