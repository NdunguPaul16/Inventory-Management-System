import mongoose, { Schema } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Smoke test: the test database is a replica set, so multi-document transactions work.
 * Every stock posting from Phase 2 onwards depends on this.
 */
const Ledger = mongoose.model(
  'SmokeLedger',
  new Schema({ ref: String, qty: Number }, { collection: 'smoke_ledger' }),
);
const Balance = mongoose.model(
  'SmokeBalance',
  new Schema({ _id: String, qty: Number }, { collection: 'smoke_balances' }),
);

beforeAll(async () => {
  // Create collections up front so DDL doesn't run inside the transactions.
  await Promise.all([Ledger.createCollection(), Balance.createCollection()]);
});

beforeEach(async () => {
  await Promise.all([Ledger.deleteMany({}), Balance.deleteMany({})]);
  await Balance.create({ _id: 'ITEM-1', qty: 10 });
});

describe('MongoDB transactions (replica set)', () => {
  it('runs on a replica set', async () => {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    expect(hello.setName).toBeTruthy();
  });

  it('commits writes to several collections atomically', async () => {
    await mongoose.connection.transaction(async (session) => {
      await Ledger.create([{ ref: 'MOVE-1', qty: -4 }], { session });
      await Balance.updateOne({ _id: 'ITEM-1' }, { $inc: { qty: -4 } }, { session });
    });

    expect(await Ledger.countDocuments()).toBe(1);
    expect((await Balance.findById('ITEM-1').lean())?.qty).toBe(6);
  });

  it('rolls back every write when the transaction aborts', async () => {
    await expect(
      mongoose.connection.transaction(async (session) => {
        await Ledger.create([{ ref: 'MOVE-2', qty: -20 }], { session });
        const balance = await Balance.findOneAndUpdate(
          { _id: 'ITEM-1' },
          { $inc: { qty: -20 } },
          { session, returnDocument: 'after' },
        );
        if (balance!.qty! < 0) throw new Error('Negative stock');
      }),
    ).rejects.toThrow('Negative stock');

    expect(await Ledger.countDocuments()).toBe(0);
    expect((await Balance.findById('ITEM-1').lean())?.qty).toBe(10);
  });

  it('hides uncommitted writes from readers outside the transaction', async () => {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await Ledger.create([{ ref: 'MOVE-3', qty: 1 }], { session });
      expect(await Ledger.countDocuments()).toBe(0);
      await session.commitTransaction();
      expect(await Ledger.countDocuments()).toBe(1);
    } finally {
      await session.endSession();
    }
  });
});
