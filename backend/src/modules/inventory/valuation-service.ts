import { Types } from 'mongoose';
import type { z, stockValuationQuerySchema } from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { StockMovement } from './engine/models.js';

type ValuationQuery = z.infer<typeof stockValuationQuerySchema>;
type ValuationRow = {
  _id: { itemId: Types.ObjectId; locationId: Types.ObjectId };
  quantity: Types.Decimal128;
  value: Types.Decimal128;
};

/** Sum recorded movement quantities and cents, including exact transfer/reversal costs. */
export async function getStockValuationAsAt(query: ValuationQuery) {
  const asAt = new Date(query.asAt);
  if (!Number.isFinite(asAt.getTime())) throw AppError.badRequest('asAt must be a valid UTC time');
  const match: Record<string, unknown> = { postedAt: { $lte: asAt } };
  if (query.itemId) match.itemId = new Types.ObjectId(query.itemId);
  if (query.locationId) match.locationId = new Types.ObjectId(query.locationId);
  const rows = await StockMovement.aggregate<ValuationRow>([
    { $match: match },
    {
      $group: {
        _id: { itemId: '$itemId', locationId: '$locationId' },
        quantity: {
          $sum: {
            $cond: [{ $eq: ['$direction', 'IN'] }, '$quantity', { $multiply: ['$quantity', -1] }],
          },
        },
        value: {
          $sum: {
            $cond: [
              { $eq: ['$direction', 'IN'] },
              { $toDecimal: '$totalCost' },
              { $multiply: [{ $toDecimal: '$totalCost' }, -1] },
            ],
          },
        },
      },
    },
    { $sort: { '_id.itemId': 1, '_id.locationId': 1 } },
  ]);
  return rows.map((row) => {
    const value = Number(row.value.toString());
    if (!Number.isSafeInteger(value))
      throw AppError.conflict('Historical valuation exceeds safe whole cents');
    return {
      itemId: String(row._id.itemId),
      locationId: String(row._id.locationId),
      quantity: row.quantity.toString(),
      value,
    };
  });
}
