import { Schema, model, type Types } from 'mongoose';

export interface RoleDoc {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<RoleDoc>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    permissions: { type: [String], required: true, default: [] },
    isSystem: { type: Boolean, required: true, default: false },
  },
  { collection: 'roles', timestamps: true },
);
roleSchema.index({ name: 1 }, { unique: true });

export const Role = model<RoleDoc>('Role', roleSchema);
