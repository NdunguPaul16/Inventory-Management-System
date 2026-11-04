import { Schema, model, type Types } from 'mongoose';

export interface UserDoc {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  roleIds: Types.ObjectId[];
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    roleIds: { type: [Schema.Types.ObjectId], ref: 'Role', required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
    failedLoginCount: { type: Number, required: true, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
  },
  { collection: 'users', timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });

export const User = model<UserDoc>('User', userSchema);
