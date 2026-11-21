import { Decimal } from 'decimal.js';
import { Types } from 'mongoose';
import { AppError } from '../../lib/errors.js';

/** Convert a decimal without rounding beyond MongoDB's Decimal128 range. */
export function stockDecimal128(value: { toString(): string }): Types.Decimal128 {
  try {
    return Types.Decimal128.fromString(value.toString());
  } catch {
    throw AppError.badRequest('Quantity exceeds the supported decimal range');
  }
}

/** Reject quantities that would create an approved request the engine cannot post. */
export function assertRepresentableStockQuantity(value: string): void {
  try {
    stockDecimal128(new Decimal(value));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest('Quantity must be a valid decimal number');
  }
}
