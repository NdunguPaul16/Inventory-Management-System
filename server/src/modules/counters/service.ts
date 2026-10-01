import type { ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { Counter } from './model.js';

/** Business time zone: document years follow the Nairobi calendar, not UTC. */
export const BUSINESS_TIME_ZONE = 'Africa/Nairobi';

const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const SEQ_DIGITS = 5;

const yearFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
});

export function businessYear(date: Date): number {
  return Number(yearFormatter.format(date));
}

/** `GRN`, 2026, 42 → `GRN-2026-00042`. Sequences past 99999 simply get longer. */
export function formatDocumentNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

export interface NextNumberOptions {
  /** Date the document belongs to. Defaults to now. */
  date?: Date;
  /** Pass the posting session so the number rolls back if the transaction aborts. */
  session?: ClientSession;
}

/**
 * Atomically reserves the next document number for `prefix` (e.g. `GRN-2026-00042`).
 * The counter resets each business year.
 *
 * TODO(phase-1): read prefixes and formats from the numbering settings.
 */
export async function nextDocumentNumber(
  prefix: string,
  options: NextNumberOptions = {},
): Promise<string> {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw AppError.badRequest(`Invalid document prefix "${prefix}"`);
  }
  const year = businessYear(options.date ?? new Date());
  const id = `${prefix}-${year}`;

  const increment = () =>
    Counter.findOneAndUpdate(
      { _id: id },
      { $inc: { seq: 1 }, $setOnInsert: { prefix, year } },
      { upsert: true, returnDocument: 'after', session: options.session ?? null, lean: true },
    );

  let counter;
  try {
    counter = await increment();
  } catch (err) {
    // Two first-ever upserts can race on the unique _id. The loser just retries the $inc.
    if ((err as { code?: unknown }).code !== 11000 || options.session) throw err;
    counter = await increment();
  }
  if (!counter) throw new Error(`Counter ${id} was not returned after upsert`);
  return formatDocumentNumber(prefix, year, counter.seq);
}
