import { Schema, model, type Types } from 'mongoose';

export const STOCK_COUNT_STATUSES = [
  'FROZEN',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'POSTED',
] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export interface StockCountDoc {
  _id: Types.ObjectId;
  countNo: string;
  itemId: Types.ObjectId;
  locationId: Types.ObjectId;
  activeKey?: string;
  status: StockCountStatus;
  mode: 'QUANTITY' | 'SERIAL';
  bookQuantity: Types.Decimal128;
  bookSerialNumbers?: string[];
  bookValue: number;
  bookVersion: number;
  frozenAt: Date;
  frozenBy: Types.ObjectId;
  countedQuantity?: Types.Decimal128;
  countedSerialNumbers?: string[];
  varianceQuantity?: Types.Decimal128;
  inboundUnitCost?: number;
  reason?: string;
  countedAt?: Date;
  countedBy?: Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectionReason?: string;
  postedAt?: Date;
  postedBy?: Types.ObjectId;
  movementIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const stockCountSchema = new Schema<StockCountDoc>(
  {
    countNo: { type: String, required: true, unique: true },
    itemId: { type: Schema.Types.ObjectId, required: true, ref: 'Item' },
    locationId: { type: Schema.Types.ObjectId, required: true, ref: 'Location' },
    activeKey: { type: String },
    status: { type: String, enum: STOCK_COUNT_STATUSES, required: true },
    mode: { type: String, enum: ['QUANTITY', 'SERIAL'], required: true, default: 'QUANTITY' },
    bookQuantity: { type: Schema.Types.Decimal128, required: true },
    bookSerialNumbers: { type: [String], default: undefined },
    bookValue: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    bookVersion: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    frozenAt: { type: Date, required: true },
    frozenBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    countedQuantity: Schema.Types.Decimal128,
    countedSerialNumbers: { type: [String], default: undefined },
    varianceQuantity: Schema.Types.Decimal128,
    inboundUnitCost: { type: Number, min: 0, validate: Number.isSafeInteger },
    reason: String,
    countedAt: Date,
    countedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: String,
    postedAt: Date,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    movementIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { collection: 'stock_counts', timestamps: true },
);
stockCountSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
stockCountSchema.index({ status: 1, createdAt: -1, _id: -1 });
stockCountSchema.index({ itemId: 1, locationId: 1, createdAt: -1 });

export const StockCount = model<StockCountDoc>('StockCount', stockCountSchema);
