import mongoose from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Counter } from '../src/modules/counters/model.js';
import {
  businessYear,
  formatDocumentNumber,
  nextDocumentNumber,
} from '../src/modules/counters/service.js';

const in2026 = new Date('2026-06-15T09:00:00Z');

beforeAll(async () => {
  await Counter.createCollection();
});

beforeEach(async () => {
  await Counter.deleteMany({});
});

describe('formatDocumentNumber', () => {
  it('pads the sequence to five digits', () => {
    expect(formatDocumentNumber('GRN', 2026, 42)).toBe('GRN-2026-00042');
    expect(formatDocumentNumber('INV', 2026, 123_456)).toBe('INV-2026-123456');
  });
});

describe('businessYear', () => {
  it('uses the Africa/Nairobi calendar (UTC+3)', () => {
    expect(businessYear(new Date('2026-12-31T20:59:59Z'))).toBe(2026);
    expect(businessYear(new Date('2026-12-31T21:00:00Z'))).toBe(2027);
  });
});

describe('nextDocumentNumber', () => {
  it('starts at 00001 and increments per prefix', async () => {
    expect(await nextDocumentNumber('GRN', { date: in2026 })).toBe('GRN-2026-00001');
    expect(await nextDocumentNumber('GRN', { date: in2026 })).toBe('GRN-2026-00002');
    expect(await nextDocumentNumber('PO', { date: in2026 })).toBe('PO-2026-00001');
  });

  it('resets the sequence each business year', async () => {
    await nextDocumentNumber('INV', { date: in2026 });
    await nextDocumentNumber('INV', { date: in2026 });
    // 22:00 UTC on 31 Dec is already 1 Jan in Nairobi.
    expect(await nextDocumentNumber('INV', { date: new Date('2026-12-31T22:00:00Z') })).toBe(
      'INV-2027-00001',
    );
    expect(await nextDocumentNumber('INV', { date: in2026 })).toBe('INV-2026-00003');
  });

  it('never hands out the same number under concurrency', async () => {
    const n = 50;
    const numbers = await Promise.all(
      Array.from({ length: n }, () => nextDocumentNumber('GRN', { date: in2026 })),
    );
    expect(new Set(numbers).size).toBe(n);
    const seqs = numbers.map((s) => Number(s.split('-')[2])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });

  it('rejects invalid prefixes', async () => {
    await expect(nextDocumentNumber('grn')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(nextDocumentNumber('G')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(nextDocumentNumber('GRN-1')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rolls the number back when the surrounding transaction aborts', async () => {
    await nextDocumentNumber('ADJ', { date: in2026 });

    const session = await mongoose.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          const inside = await nextDocumentNumber('ADJ', { date: in2026, session });
          expect(inside).toBe('ADJ-2026-00002');
          throw new Error('posting failed');
        }),
      ).rejects.toThrow('posting failed');
    } finally {
      await session.endSession();
    }

    expect(await nextDocumentNumber('ADJ', { date: in2026 })).toBe('ADJ-2026-00002');
  });

  it('keeps the number when the transaction commits', async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await nextDocumentNumber('TRF', { date: in2026, session });
      });
    } finally {
      await session.endSession();
    }
    expect(await nextDocumentNumber('TRF', { date: in2026 })).toBe('TRF-2026-00002');
  });
});
