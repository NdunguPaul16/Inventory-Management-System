import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CostLayer,
  PostingRequest,
  SerialNumber,
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
import type { PostInput, SourceDocument } from '../src/modules/inventory/engine/types.js';
import { Counter } from '../src/modules/counters/model.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';

const actorId = new Types.ObjectId();

let itemId: Types.ObjectId;
let sourceLocationId: Types.ObjectId;
let destinationLocationId: Types.ObjectId;
let sequence = 0;

function source(type = 'TEST'): SourceDocument {
  sequence += 1;
  return { type, id: `test-${sequence}`, number: `TEST-${sequence}` };
}

function key(label: string): string {
  return `${label}-${randomUUID()}`;
}

function input(
  overrides: Partial<PostInput> & Pick<PostInput, 'quantity' | 'movementType'>,
): PostInput {
  return {
    itemId,
    locationId: sourceLocationId,
    sourceDoc: source(),
    postedBy: actorId,
    idempotencyKey: key('posting'),
    unitCost: 1_000,
    ...overrides,
  };
}

function amount(value: { toString(): string }): string {
  return value.toString();
}

beforeAll(async () => {
  await Promise.all([
    Item.createCollection(),
    Location.createCollection(),
    Counter.createCollection(),
    StockMovement.createCollection(),
    CostLayer.createCollection(),
    StockBalance.createCollection(),
    SerialNumber.createCollection(),
    PostingRequest.createCollection(),
  ]);
  await Promise.all([
    Item.syncIndexes(),
    Location.syncIndexes(),
    Counter.syncIndexes(),
    StockMovement.syncIndexes(),
    CostLayer.syncIndexes(),
    StockBalance.syncIndexes(),
    SerialNumber.syncIndexes(),
    PostingRequest.syncIndexes(),
  ]);
});

beforeEach(async () => {
  sequence = 0;
  await Promise.all([
    Item.deleteMany({}),
    Location.deleteMany({}),
    Counter.deleteMany({}),
    StockMovement.deleteMany({}),
    CostLayer.deleteMany({}),
    StockBalance.deleteMany({}),
    SerialNumber.deleteMany({}),
    PostingRequest.deleteMany({}),
  ]);
  const [item, sourceLocation, destinationLocation] = await Promise.all([
    Item.create({
      sku: `TEST-${randomUUID().slice(0, 8)}`,
      name: 'Test inventory item',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    }),
    Location.create({
      code: `SOURCE-${randomUUID().slice(0, 6)}`,
      name: 'Source',
      type: 'WAREHOUSE',
    }),
    Location.create({
      code: `DEST-${randomUUID().slice(0, 6)}`,
      name: 'Destination',
      type: 'WAREHOUSE',
    }),
  ]);
  itemId = item._id;
  sourceLocationId = sourceLocation._id;
  destinationLocationId = destinationLocation._id;
});

describe('FIFO stock engine', () => {
  it('consumes the oldest cost layers first and records the exact layer slices', async () => {
    await postIn(input({ quantity: '10', movementType: 'OPENING', unitCost: 26_000 }));
    await postIn(input({ quantity: '10', movementType: 'OPENING', unitCost: 28_000 }));
    const receivedLayers = await CostLayer.find({ itemId, locationId: sourceLocationId }).lean();
    expect(receivedLayers).toHaveLength(2);
    expect(receivedLayers.map((layer) => amount(layer.remainingQty))).toEqual(['10', '10']);

    const result = await postOut(input({ quantity: '12', movementType: 'SALE' }));
    expect(result.replayed).toBe(false);
    expect(result.movements[0]?.totalCost).toBe(316_000);

    const outbound = await StockMovement.findById(result.movementIds[0]).lean();
    expect(outbound?.layersConsumed).toHaveLength(2);
    expect(
      outbound?.layersConsumed?.map((slice) => [amount(slice.quantity), slice.unitCost]),
    ).toEqual([
      ['10', 26_000],
      ['2', 28_000],
    ]);

    const layers = await CostLayer.find({ itemId, locationId: sourceLocationId })
      .sort({ receivedAt: 1, _id: 1 })
      .lean();
    expect(layers.map((layer) => amount(layer.remainingQty))).toEqual(['0', '8']);
    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe('8');
    expect(balance!.value).toBe(224_000);
  });

  it('rejects insufficient stock and rolls back all attempted writes', async () => {
    await postIn(input({ quantity: '5', movementType: 'OPENING', unitCost: 10_000 }));

    await expect(postOut(input({ quantity: '6', movementType: 'SALE' }))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });

    expect(await StockMovement.countDocuments()).toBe(1);
    const layer = await CostLayer.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(layer!.remainingQty)).toBe('5');
    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe('5');
    expect(balance!.value).toBe(50_000);
  });

  it('never oversells when concurrent outbound postings target the same stock', async () => {
    await postIn(input({ quantity: '10', movementType: 'OPENING', unitCost: 9_000 }));

    const results = await Promise.allSettled([
      postOut(input({ quantity: '7', movementType: 'SALE' })),
      postOut(input({ quantity: '7', movementType: 'SALE' })),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof postOut>>> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe('3');
    expect(balance!.value).toBe(27_000);
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('preserves each source layer cost and received date when stock is transferred', async () => {
    const receivedAt = new Date('2026-01-20T06:00:00.000Z');
    await postIn(
      input({
        quantity: '6',
        movementType: 'OPENING',
        unitCost: 14_500,
        receivedAt,
      }),
    );

    const result = await transfer({
      itemId,
      fromLocationId: sourceLocationId,
      toLocationId: destinationLocationId,
      quantity: '4',
      sourceDoc: source('TRANSFER'),
      postedBy: actorId,
      idempotencyKey: key('transfer'),
    });
    expect(result.movements).toHaveLength(2);

    const destinationLayer = await CostLayer.findOne({
      itemId,
      locationId: destinationLocationId,
    }).lean();
    expect(amount(destinationLayer!.remainingQty)).toBe('4');
    expect(destinationLayer!.unitCost).toBe(14_500);
    expect(destinationLayer!.receivedAt).toEqual(receivedAt);

    const [sourceBalance, destinationBalance] = await Promise.all([
      StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean(),
      StockBalance.findOne({ itemId, locationId: destinationLocationId }).lean(),
    ]);
    expect(amount(sourceBalance!.onHand)).toBe('2');
    expect(amount(destinationBalance!.onHand)).toBe('4');
    expect(await reconcileBalances()).toEqual({ checked: 2, differences: [] });
  });

  it('conserves the recorded value of a fractional FIFO slice during transfer', async () => {
    const receipt = await postIn(
      input({ quantity: '0.5', movementType: 'OPENING', unitCost: 101 }),
    );
    expect(receipt.movements[0]?.totalCost).toBe(51);

    const moved = await transfer({
      itemId,
      fromLocationId: sourceLocationId,
      toLocationId: destinationLocationId,
      quantity: '0.1',
      sourceDoc: source('TRANSFER'),
      postedBy: actorId,
      idempotencyKey: key('fractional-transfer'),
    });
    expect(moved.movements.map((movement) => movement.totalCost)).toEqual([11, 11]);
    const [sourceBalance, destinationBalance, destinationLayer] = await Promise.all([
      StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean(),
      StockBalance.findOne({ itemId, locationId: destinationLocationId }).lean(),
      CostLayer.findOne({ itemId, locationId: destinationLocationId }).lean(),
    ]);
    expect(amount(sourceBalance!.onHand)).toBe('0.4');
    expect(sourceBalance!.value).toBe(40);
    expect(amount(destinationBalance!.onHand)).toBe('0.1');
    expect(destinationBalance!.value).toBe(11);
    expect(destinationLayer!.remainingValue).toBe(11);
    expect(sourceBalance!.value + destinationBalance!.value).toBe(51);
    expect(await reconcileBalances()).toEqual({ checked: 2, differences: [] });
  });

  it('reverses an outbound movement at its original FIFO cost and restores availability', async () => {
    await postIn(input({ quantity: '7', movementType: 'OPENING', unitCost: 12_300 }));
    const issued = await postOut(input({ quantity: '3', movementType: 'SALE' }));

    const reversal = await reverse({
      movementId: issued.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('reverse'),
    });
    expect(reversal.movements).toHaveLength(1);
    expect(reversal.movements[0]?.direction).toBe('IN');
    expect(reversal.movements[0]?.totalCost).toBe(36_900);

    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe('7');
    expect(balance!.value).toBe(86_100);
    const reverseMovement = await StockMovement.findById(reversal.movementIds[0]).lean();
    expect(String(reverseMovement!.reversalOf)).toBe(issued.movementIds[0]);
    await expect(
      reverse({
        movementId: issued.movementIds[0]!,
        postedBy: actorId,
        idempotencyKey: key('again'),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('returns the recorded value of a fractional outbound slice during reversal', async () => {
    await postIn(input({ quantity: '0.5', movementType: 'OPENING', unitCost: 101 }));
    const issued = await postOut(input({ quantity: '0.1', movementType: 'SALE' }));
    expect(issued.movements[0]?.totalCost).toBe(11);
    const reversal = await reverse({
      movementId: issued.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('fractional-reversal'),
    });
    expect(reversal.movements[0]?.totalCost).toBe(11);
    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    const layers = await CostLayer.find({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe('0.5');
    expect(balance!.value).toBe(51);
    expect(layers.reduce((sum, layer) => sum + layer.remainingValue!, 0)).toBe(51);
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('replays an idempotent request without posting another movement', async () => {
    const idempotencyKey = key('repeat');
    const posting = input({
      quantity: '4',
      movementType: 'OPENING',
      unitCost: 2_500,
      idempotencyKey,
    });
    const first = await postIn(posting);
    const replay = await postIn(posting);

    expect(replay).toMatchObject({ movementIds: first.movementIds, replayed: true });
    expect(await StockMovement.countDocuments()).toBe(1);
    await expect(postIn({ ...posting, quantity: '5' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reconciles balances after a deterministic sequence of inbound and outbound postings', async () => {
    let available = 0;
    let state = 123_456_789;
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state;
    };

    for (let index = 0; index < 40; index += 1) {
      const inbound = available === 0 || next() % 3 !== 0;
      if (inbound) {
        const quantity = (next() % 5) + 1;
        await postIn(
          input({
            quantity: String(quantity),
            movementType: 'OPENING',
            unitCost: ((next() % 20) + 1) * 100,
          }),
        );
        available += quantity;
      } else {
        const quantity = Math.min((next() % 4) + 1, available);
        await postOut(input({ quantity: String(quantity), movementType: 'SALE' }));
        available -= quantity;
      }
    }

    const reconciliation = await reconcileBalances();
    expect(reconciliation).toEqual({ checked: 1, differences: [] });
    const balance = await StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean();
    expect(amount(balance!.onHand)).toBe(String(available));
  });
});
