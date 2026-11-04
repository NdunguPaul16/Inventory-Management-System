import { Schema, model } from 'mongoose';

export const LOCATION_TYPES = ['WAREHOUSE', 'WORKSHOP', 'SHOWROOM', 'IN_TRANSIT'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export interface LocationDoc {
  code: string;
  name: string;
  type: LocationType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<LocationDoc>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LOCATION_TYPES, required: true },
    isActive: { type: Boolean, default: true },
  },
  { collection: 'locations', timestamps: true },
);
locationSchema.index({ code: 1 }, { unique: true });

export const Location = model<LocationDoc>('Location', locationSchema);
