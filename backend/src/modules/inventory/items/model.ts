import { Schema, model } from 'mongoose';
import { ITEM_TYPES } from '@ims/shared';

export { ITEM_TYPES } from '@ims/shared';
export type ItemType = (typeof ITEM_TYPES)[number];

export interface ItemDoc {
  sku: string;
  name: string;
  type: ItemType;
  baseUnit: string;
  description?: string;
  unitConversions: { unit: string; baseQuantity: string }[];
  reorderLevel?: string | null;
  reorderQty?: string | null;
  leadTimeDays?: number | null;
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
    description: { type: String, trim: true },
    unitConversions: {
      type: [
        new Schema(
          {
            unit: { type: String, required: true, trim: true, uppercase: true },
            baseQuantity: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    reorderLevel: String,
    reorderQty: String,
    leadTimeDays: { type: Number, min: 0, max: 3650 },
    trackSerial: { type: Boolean, default: false },
    trackBatch: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { collection: 'items', timestamps: true },
);
itemSchema.index({ sku: 1 }, { unique: true });

export const Item = model<ItemDoc>('Item', itemSchema);
