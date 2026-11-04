import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';
import { connectDb } from '../../src/config/db.js';

// Each test file gets its own database on the shared replica set.
const dbName = `test_${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  await connectDb(inject('mongoUri'), { dbName });
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
