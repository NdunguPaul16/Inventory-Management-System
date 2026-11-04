import { Schema, model } from 'mongoose';

export interface CounterDoc {
  /** `<PREFIX>-<YEAR>`, e.g. `GRN-2026`. One sequence per prefix per year. */
  _id: string;
  prefix: string;
  year: number;
  seq: number;
  updatedAt: Date;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    prefix: { type: String, required: true },
    year: { type: Number, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: 'counters', versionKey: false, timestamps: { createdAt: false, updatedAt: true } },
);

export const Counter = model<CounterDoc>('Counter', counterSchema);
