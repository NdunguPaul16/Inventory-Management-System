import type { Types } from 'mongoose';

export const STOCK_MOVEMENT_TYPES = [
  'OPENING',
  'GRN',
  'PRODUCTION_ISSUE',
  'PRODUCTION_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'COUNT_VARIANCE',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export type StockDirection = 'IN' | 'OUT';

export interface SourceDocument {
  type: string;
  id: string;
  number: string;
  lineId?: string;
}

export interface PostInput {
  itemId: Types.ObjectId | string;
  locationId: Types.ObjectId | string;
  quantity: string;
  movementType: StockMovementType;
  sourceDoc: SourceDocument;
  postedBy: Types.ObjectId | string;
  idempotencyKey: string;
  /** Cost per base unit in KES cents; required only for inbound movements. */
  unitCost?: number;
  receivedAt?: Date;
  serialNumbers?: string[];
  reason?: string;
}

export interface TransferInput {
  itemId: Types.ObjectId | string;
  fromLocationId: Types.ObjectId | string;
  toLocationId: Types.ObjectId | string;
  quantity: string;
  sourceDoc: SourceDocument;
  postedBy: Types.ObjectId | string;
  idempotencyKey: string;
  serialNumbers?: string[];
}

export interface MovementResult {
  movementIds: string[];
  movements: Array<{
    id: string;
    movementNo: string;
    direction: StockDirection;
    quantity: string;
    totalCost: number;
  }>;
  replayed: boolean;
}
