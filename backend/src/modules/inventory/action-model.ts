import { Schema, model, type Types } from 'mongoose';

export const STOCK_ACTION_TYPES = ['OPENING', 'ADJUSTMENT', 'REVERSAL'] as const;
export type StockActionType = (typeof STOCK_ACTION_TYPES)[number];
export const STOCK_ACTION_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'POSTED',
] as const;
export type StockActionStatus = (typeof STOCK_ACTION_STATUSES)[number];

export interface StockActionDoc {
  _id: Types.ObjectId;
  actionNo: string;
  actionType: StockActionType;
  status: StockActionStatus;
  payload: Record<string, unknown>;
  requestedBy: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  postedBy?: Types.ObjectId;
  postedAt?: Date;
  movementIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const stockActionSchema = new Schema<StockActionDoc>(
  {
    actionNo: { type: String, required: true, unique: true },
    actionType: { type: String, enum: STOCK_ACTION_TYPES, required: true },
    status: {
      type: String,
      enum: STOCK_ACTION_STATUSES,
      required: true,
      default: 'PENDING_APPROVAL',
    },
    payload: { type: Schema.Types.Mixed, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: String,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    postedAt: Date,
    movementIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { collection: 'stock_action_requests', timestamps: true },
);
stockActionSchema.index({ status: 1, actionType: 1, createdAt: -1, _id: -1 });

export const StockAction = model<StockActionDoc>('StockAction', stockActionSchema);
