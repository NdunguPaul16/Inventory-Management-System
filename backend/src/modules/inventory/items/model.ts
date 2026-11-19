import { Schema, model } from 'mongoose';
import { ITEM_TYPES } from '@ims/shared';

export { ITEM_TYPES } from '@ims/shared';
export type ItemType = (typeof ITEM_TYPES)[number];

export interface ItemDoc {
  sku: string;
  name: string;
  type: ItemType;
  baseUnit: string;
  trackSerial: boolean;
  trackBatch: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<ItemDoc>(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ITEM_TYPES, required: true },
    baseUnit: { type: String, required: true, trim: true, uppercase: true },
    trackSerial: { type: Boolean, default: false },
    trackBatch: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { collection: 'items', timestamps: true },
);
itemSchema.index({ sku: 1 }, { unique: true });

export const Item = model<ItemDoc>('Item', itemSchema);
