import { Schema, model, type Types } from 'mongoose';
import type { StockMovementType } from './types.js';

export interface LayerSlice {
  layerId: Types.ObjectId;
  quantity: Types.Decimal128;
  unitCost: number;
  totalCost: number;
}

const layerSliceSchema = new Schema<LayerSlice>(
  {
    layerId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Schema.Types.Decimal128, required: true },
    unitCost: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    totalCost: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  },
  { _id: false },
);

export interface StockMovementDoc {
  _id: Types.ObjectId;
  movementNo: string;
  itemId: Types.ObjectId;
  locationId: Types.ObjectId;
  direction: 'IN' | 'OUT';
  quantity: Types.Decimal128;
  movementType: StockMovementType;
  unitCost: number;
  totalCost: number;
  layersConsumed?: LayerSlice[];
  layerCreated?: Types.ObjectId;
  sourceDoc: { type: string; id: string; number: string; lineId?: string };
  serialNumbers: string[];
  reason?: string;
  reversalOf?: Types.ObjectId;
  idempotencyKey: string;
  postedAt: Date;
  postedBy: Types.ObjectId;
}

const movementSchema = new Schema<StockMovementDoc>(
  {
    movementNo: { type: String, required: true, unique: true },
    itemId: { type: Schema.Types.ObjectId, required: true, ref: 'Item' },
    locationId: { type: Schema.Types.ObjectId, required: true, ref: 'Location' },
    direction: { type: String, enum: ['IN', 'OUT'], required: true },
    quantity: { type: Schema.Types.Decimal128, required: true },
    movementType: {
      type: String,
      enum: [
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
      ],
      required: true,
    },
    unitCost: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    totalCost: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    layersConsumed: { type: [layerSliceSchema], default: undefined },
    layerCreated: { type: Schema.Types.ObjectId, ref: 'CostLayer' },
    sourceDoc: {
      type: new Schema(
        {
          type: { type: String, required: true },
          id: { type: String, required: true },
          number: { type: String, required: true },
          lineId: String,
        },
        { _id: false },
      ),
      required: true,
    },
    serialNumbers: { type: [String], default: [] },
    reason: { type: String, trim: true },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'StockMovement' },
    idempotencyKey: { type: String, required: true },
    postedAt: { type: Date, required: true },
    postedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'stock_movements', versionKey: false },
);
movementSchema.index({ idempotencyKey: 1, itemId: 1, locationId: 1 });
movementSchema.index({ itemId: 1, locationId: 1, postedAt: -1, _id: -1 });
movementSchema.index({ 'sourceDoc.type': 1, 'sourceDoc.id': 1 });

export interface CostHistoryEntry {
  at: Date;
  oldUnitCost: number;
  newUnitCost: number;
  reason: string;
  docRef: string;
}

export interface CostLayerDoc {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  locationId: Types.ObjectId;
  sourceDoc: { type: string; id: string; number: string };
  receivedAt: Date;
  originalQty: Types.Decimal128;
  remainingQty: Types.Decimal128;
  originalValue?: number;
  remainingValue?: number;
  unitCost: number;
  costHistory: CostHistoryEntry[];
  createdFromLayerId?: Types.ObjectId;
}

const costHistorySchema = new Schema<CostHistoryEntry>(
  {
    at: { type: Date, required: true },
    oldUnitCost: { type: Number, required: true },
    newUnitCost: { type: Number, required: true },
    reason: { type: String, required: true },
    docRef: { type: String, required: true },
  },
  { _id: false },
);
const costLayerSchema = new Schema<CostLayerDoc>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true, ref: 'Item' },
    locationId: { type: Schema.Types.ObjectId, required: true, ref: 'Location' },
    sourceDoc: {
      type: new Schema(
        {
          type: { type: String, required: true },
          id: { type: String, required: true },
          number: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    receivedAt: { type: Date, required: true },
    originalQty: { type: Schema.Types.Decimal128, required: true },
    remainingQty: { type: Schema.Types.Decimal128, required: true },
    originalValue: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    remainingValue: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    unitCost: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    costHistory: { type: [costHistorySchema], default: [] },
    createdFromLayerId: { type: Schema.Types.ObjectId, ref: 'CostLayer' },
  },
  {
    collection: 'cost_layers',
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: true },
  },
);
costLayerSchema.index({ itemId: 1, locationId: 1, receivedAt: 1, _id: 1 });
costLayerSchema.index({ itemId: 1, locationId: 1, remainingQty: 1 });

export interface StockBalanceDoc {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  locationId: Types.ObjectId;
  onHand: Types.Decimal128;
  reserved: Types.Decimal128;
  value: number;
  version: number;
  lastMovementAt?: Date;
}

const stockBalanceSchema = new Schema<StockBalanceDoc>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true, ref: 'Item' },
    locationId: { type: Schema.Types.ObjectId, required: true, ref: 'Location' },
    onHand: { type: Schema.Types.Decimal128, required: true, default: '0' },
    reserved: { type: Schema.Types.Decimal128, required: true, default: '0' },
    value: { type: Number, required: true, default: 0 },
    version: { type: Number, required: true, default: 0 },
    lastMovementAt: Date,
  },
  { collection: 'stock_balances', versionKey: false },
);
stockBalanceSchema.index({ itemId: 1, locationId: 1 }, { unique: true });

export interface PostingRequestDoc {
  _id: string;
  requestHash: string;
  movementIds: Types.ObjectId[];
  completedAt: Date;
}
const postingRequestSchema = new Schema<PostingRequestDoc>(
  {
    _id: { type: String, required: true },
    requestHash: { type: String, required: true },
    movementIds: { type: [Schema.Types.ObjectId], required: true },
    completedAt: { type: Date, required: true },
  },
  { collection: 'posting_requests', versionKey: false },
);

export const StockMovement = model<StockMovementDoc>('StockMovement', movementSchema);
export const CostLayer = model<CostLayerDoc>('CostLayer', costLayerSchema);
export const StockBalance = model<StockBalanceDoc>('StockBalance', stockBalanceSchema);
export const PostingRequest = model<PostingRequestDoc>('PostingRequest', postingRequestSchema);

export interface SerialNumberDoc {
  _id: Types.ObjectId;
  serialNo: string;
  itemId: Types.ObjectId;
  locationId: Types.ObjectId;
  status: 'IN_STOCK' | 'ISSUED';
  lastMovementId: Types.ObjectId;
}
const serialNumberSchema = new Schema<SerialNumberDoc>(
  {
    serialNo: { type: String, required: true, trim: true, uppercase: true },
    itemId: { type: Schema.Types.ObjectId, required: true, ref: 'Item' },
    locationId: { type: Schema.Types.ObjectId, required: true, ref: 'Location' },
    status: { type: String, enum: ['IN_STOCK', 'ISSUED'], required: true },
    lastMovementId: { type: Schema.Types.ObjectId, required: true, ref: 'StockMovement' },
  },
  {
    collection: 'serial_numbers',
    versionKey: false,
    timestamps: { createdAt: false, updatedAt: true },
  },
);
serialNumberSchema.index({ serialNo: 1 }, { unique: true });
serialNumberSchema.index({ itemId: 1, locationId: 1, status: 1 });
export const SerialNumber = model<SerialNumberDoc>('SerialNumber', serialNumberSchema);
