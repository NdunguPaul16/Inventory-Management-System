import { Schema, model } from 'mongoose';

interface BootstrapLockDoc {
  _id: string;
  createdAt: Date;
}

const bootstrapLockSchema = new Schema<BootstrapLockDoc>(
  {
    _id: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: 'bootstrap_locks', versionKey: false },
);

export const BootstrapLock = model<BootstrapLockDoc>('BootstrapLock', bootstrapLockSchema);
