import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CostLayer,
  PostingRequest,
  SerialNumber,
  StockBalance,
  StockMovement,
} from '../src/modules/inventory/engine/models.js';
import {
  assertStockInvariants,
  getFifoLayers,
  getMovementHistory,
  getStockBalance,
  listStockBalances,
  postAdjustment,
  postIn,
  postOpeningStock,
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

  it('reverses a fully available receipt and rejects reversal after consumption', async () => {
    const first = await postOpeningStock(
      input({ quantity: '2', movementType: 'OPENING', unitCost: 101 }),
    );
    const removed = await reverse({
      movementId: first.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('reverse-receipt'),
      reason: 'Incorrect receipt',
    });
    expect(removed.movements).toMatchObject([{ direction: 'OUT', quantity: '2', totalCost: 202 }]);
    expect((await StockBalance.findOne({ itemId, locationId: sourceLocationId }))?.value).toBe(0);
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });

    const second = await postIn(input({ quantity: '3', movementType: 'OPENING', unitCost: 103 }));
    await postOut(input({ quantity: '1', movementType: 'SALE' }));
    const before = await StockMovement.countDocuments();
    await expect(
      reverse({
        movementId: second.movementIds[0]!,
        postedBy: actorId,
        idempotencyKey: key('partly-consumed'),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await StockMovement.countDocuments()).toBe(before);
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('reverses a multi-layer transfer without losing quantity, value or FIFO order', async () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-02-01T00:00:00.000Z');
    await postIn(
      input({ quantity: '2', movementType: 'OPENING', unitCost: 101, receivedAt: older }),
    );
    await postIn(
      input({ quantity: '3', movementType: 'OPENING', unitCost: 203, receivedAt: newer }),
    );
    const moved = await transfer({
      itemId,
      fromLocationId: sourceLocationId,
      toLocationId: destinationLocationId,
      quantity: '4',
      sourceDoc: source('TRANSFER'),
      postedBy: actorId,
      idempotencyKey: key('transfer-reversal'),
    });
    expect(moved.movements).toHaveLength(3);
    const undone = await reverse({
      movementId: moved.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('undo-transfer'),
    });
    expect(undone.movements.map((entry) => entry.totalCost).sort()).toEqual([202, 202, 406, 406]);
    const [sourceBalance, destinationBalance] = await Promise.all([
      StockBalance.findOne({ itemId, locationId: sourceLocationId }).lean(),
      StockBalance.findOne({ itemId, locationId: destinationLocationId }).lean(),
    ]);
    expect(amount(sourceBalance!.onHand)).toBe('5');
    expect(sourceBalance!.value).toBe(811);
    expect(amount(destinationBalance!.onHand)).toBe('0');
    expect(destinationBalance!.value).toBe(0);
    expect(await reconcileBalances()).toEqual({ checked: 2, differences: [] });
    await expect(
      reverse({
        movementId: moved.movementIds[1]!,
        postedBy: actorId,
        idempotencyKey: key('undo-twice'),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps serial identities with stock through transfer, issue and reversal', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    const receipt = await postIn(
      input({ quantity: '2', movementType: 'OPENING', serialNumbers: ['SER-A', 'SER-B'] }),
    );
    expect(await SerialNumber.countDocuments({ status: 'IN_STOCK' })).toBe(2);
    await expect(
      postIn(input({ quantity: '1', movementType: 'OPENING', serialNumbers: ['SER-A'] })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await transfer({
      itemId,
      fromLocationId: sourceLocationId,
      toLocationId: destinationLocationId,
      quantity: '1',
      sourceDoc: source('TRANSFER'),
      postedBy: actorId,
      idempotencyKey: key('serial-transfer'),
      serialNumbers: ['SER-A'],
    });
    expect((await SerialNumber.findOne({ serialNo: 'SER-A' }))?.locationId).toEqual(
      destinationLocationId,
    );
    const issue = await postOut(
      input({
        locationId: destinationLocationId,
        quantity: '1',
        movementType: 'SALE',
        serialNumbers: ['SER-A'],
      }),
    );
    expect((await SerialNumber.findOne({ serialNo: 'SER-A' }))?.status).toBe('ISSUED');
    await reverse({
      movementId: issue.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('serial-return'),
    });
    expect((await SerialNumber.findOne({ serialNo: 'SER-A' }))?.status).toBe('IN_STOCK');
    expect(await SerialNumber.countDocuments({ status: 'IN_STOCK' })).toBe(2);
    expect(await reconcileBalances()).toEqual({ checked: 2, differences: [] });
    expect(receipt.movements[0]?.quantity).toBe('2');
  });

  it('marks serials issued when an untouched serialized receipt is reversed', async () => {
    await Item.updateOne({ _id: itemId }, { $set: { trackSerial: true } });
    const received = await postIn(
      input({ quantity: '2', movementType: 'OPENING', serialNumbers: ['UNDO-A', 'UNDO-B'] }),
    );
    const undone = await reverse({
      movementId: received.movementIds[0]!,
      postedBy: actorId,
      idempotencyKey: key('undo-serial-receipt'),
    });
    expect(undone.movements).toMatchObject([{ direction: 'OUT', quantity: '2' }]);
    expect(await SerialNumber.countDocuments({ status: 'ISSUED' })).toBe(2);
    expect((await StockBalance.findOne({ itemId, locationId: sourceLocationId }))?.value).toBe(0);
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('detects ledger drift and returns filtered stock detail for review', async () => {
    await postAdjustment({
      ...input({ quantity: '3', movementType: 'ADJUSTMENT_IN', unitCost: 77 }),
      direction: 'IN',
      reason: 'Verified surplus',
    });
    const [balances, itemBalances, layers, history] = await Promise.all([
      listStockBalances({ itemId: String(itemId) }),
      getStockBalance(String(itemId), String(sourceLocationId)),
      getFifoLayers(String(itemId), String(sourceLocationId)),
      getMovementHistory(String(itemId), { locationId: String(sourceLocationId), limit: 1 }),
    ]);
    expect(balances).toHaveLength(1);
    expect(itemBalances).toHaveLength(1);
    expect(layers).toHaveLength(1);
    expect(history).toHaveLength(1);
    expect(await getMovementHistory(String(itemId), { before: String(history[0]!._id) })).toEqual(
      [],
    );
    await expect(getMovementHistory(String(itemId), { before: 'invalid' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await assertStockInvariants()).toEqual({ checked: 1, differences: [] });
    await StockBalance.updateOne({ itemId, locationId: sourceLocationId }, { $inc: { value: 1 } });
    const drift = await reconcileBalances();
    expect(drift.differences).toHaveLength(1);
    expect(drift.differences[0]).toMatchObject({
      balanceValue: 232,
      ledgerValue: 231,
      layerValue: 231,
    });
    await expect(assertStockInvariants()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('paginates and searches stock balances before populating records', async () => {
    await postIn(input({ quantity: '1', movementType: 'OPENING', unitCost: 100 }));
    await postIn(
      input({
        locationId: destinationLocationId,
        quantity: '2',
        movementType: 'OPENING',
        unitCost: 75,
        idempotencyKey: key('balance-page-2'),
      }),
    );
    const first = await listStockBalances({ itemId: String(itemId), limit: 1 });
    expect(first).toHaveLength(1);
    const second = await listStockBalances({
      itemId: String(itemId),
      limit: 1,
      before: String(first[0]!._id),
    });
    expect(second).toHaveLength(1);
    expect(String(second[0]!._id)).not.toBe(String(first[0]!._id));
    expect(await listStockBalances({ q: 'no such item' })).toEqual([]);
    expect(await listStockBalances({ q: 'Source' })).toHaveLength(1);
    expect(await listStockBalances({ q: 'Test inventory' })).toHaveLength(2);
    expect(
      await listStockBalances({ locationId: String(sourceLocationId), limit: 1 }),
    ).toHaveLength(1);
  });

  it('pages FIFO layers in receipt order, including equal timestamps', async () => {
    for (let index = 0; index < 3; index += 1) {
      await postIn(input({ quantity: '1', movementType: 'OPENING' }));
    }
    await CostLayer.updateMany(
      { itemId, locationId: sourceLocationId },
      { $set: { receivedAt: new Date('2026-11-18T08:00:00.000Z') } },
    );
    const first = await getFifoLayers(String(itemId), String(sourceLocationId), { limit: 2 });
    expect(first).toHaveLength(2);
    const second = await getFifoLayers(String(itemId), String(sourceLocationId), {
      before: String(first[1]!._id),
      limit: 2,
    });
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((layer) => String(layer._id))).size).toBe(3);
    expect(
      await getFifoLayers(String(itemId), String(sourceLocationId), {
        before: String(second[0]!._id),
        limit: 2,
      }),
    ).toEqual([]);
    await expect(
      getFifoLayers(String(itemId), String(sourceLocationId), { before: 'invalid' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      getFifoLayers(String(itemId), String(destinationLocationId), {
        before: String(first[0]!._id),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('reconciles one snapshot while another stock receipt commits between ledger reads', async () => {
    await postIn(input({ quantity: '1', movementType: 'OPENING', unitCost: 100 }));
    const originalFind = CostLayer.find.bind(CostLayer);
    let signalRead!: () => void;
    let resumeRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      resumeRead = resolve;
    });
    const findSpy = vi.spyOn(CostLayer, 'find').mockImplementation((() => {
      const query = originalFind();
      const originalCursor = query.cursor.bind(query);
      query.cursor = (() => {
        const cursor = originalCursor();
        const originalNext = cursor.next.bind(cursor);
        let first = true;
        cursor.next = (async () => {
          if (first) {
            first = false;
            signalRead();
            await resume;
          }
          return originalNext();
        }) as typeof cursor.next;
        return cursor;
      }) as typeof query.cursor;
      return query;
    }) as typeof CostLayer.find);

    try {
      const checking = reconcileBalances();
      await readStarted;
      await postIn(input({ quantity: '1', movementType: 'GRN', unitCost: 100 }));
      resumeRead();
      expect(await checking).toEqual({ checked: 1, differences: [] });
    } finally {
      resumeRead();
      findSpy.mockRestore();
    }
    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
  });

  it('reconciles records across cursor batches and detects drift in the last movement', async () => {
    const now = new Date();
    const fixtures = Array.from({ length: 205 }, (_, index) => {
      const layerId = new Types.ObjectId();
      const sourceDoc = { type: 'TEST', id: `bulk-${index}`, number: `BULK-${index}` };
      return {
        layer: {
          _id: layerId,
          itemId,
          locationId: sourceLocationId,
          sourceDoc,
          receivedAt: now,
          originalQty: Types.Decimal128.fromString('1'),
          remainingQty: Types.Decimal128.fromString('1'),
          originalValue: 100,
          remainingValue: 100,
          unitCost: 100,
        },
        movement: {
          movementNo: `BULK-${index}`,
          itemId,
          locationId: sourceLocationId,
          direction: 'IN' as const,
          quantity: Types.Decimal128.fromString('1'),
          movementType: 'OPENING' as const,
          unitCost: 100,
          totalCost: 100,
          layerCreated: layerId,
          sourceDoc,
          idempotencyKey: `bulk-${index}`,
          postedAt: now,
          postedBy: actorId,
        },
      };
    });
    await Promise.all([
      CostLayer.insertMany(fixtures.map(({ layer }) => layer)),
      StockMovement.insertMany(fixtures.map(({ movement }) => movement)),
      StockBalance.create({
        itemId,
        locationId: sourceLocationId,
        onHand: Types.Decimal128.fromString('205'),
        value: 20_500,
      }),
    ]);

    expect(await reconcileBalances()).toEqual({ checked: 1, differences: [] });
    await StockMovement.updateOne({ movementNo: 'BULK-204' }, { $set: { totalCost: 101 } });
    expect((await reconcileBalances()).differences).toMatchObject([
      { balanceQty: '205', ledgerQty: '205', layerQty: '205', ledgerValue: 20_501 },
    ]);
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
