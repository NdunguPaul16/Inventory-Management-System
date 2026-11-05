import mongoose, { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { migrateLegacyAuditLog } from '../src/modules/audit/migrate.js';
import { AuditLog } from '../src/modules/audit/model.js';

describe('legacy audit migration', () => {
  it('preserves legacy and existing history in the unified collection and can be rerun', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Test database is not connected');
    const actorId = new Types.ObjectId();
    const legacyId = new Types.ObjectId();
    const existingId = new Types.ObjectId();
    const at = new Date('2026-01-20T06:00:00.000Z');
    await AuditLog.create({
      _id: existingId,
      action: 'user.create',
      entityType: 'user',
      entityId: String(actorId),
      at,
    });
    await db.collection('audit_log').insertOne({
      _id: legacyId,
      actorId,
      action: 'stock.post.in',
      entityType: 'stock_movement',
      entityId: new Types.ObjectId(),
      at,
      details: { source: 'legacy ledger' },
    });

    await migrateLegacyAuditLog();
    const migrated = await AuditLog.findById(legacyId).lean();
    expect(migrated).toMatchObject({
      actorId,
      action: 'stock.post.in',
      entityType: 'stock_movement',
      at,
      metadata: { source: 'legacy ledger' },
    });
    expect(migrated?.entityId).toEqual(expect.any(String));
    expect(await AuditLog.findById(existingId)).toBeTruthy();
    expect(await AuditLog.countDocuments()).toBe(2);
    expect(await db.listCollections({ name: 'audit_log' }).hasNext()).toBe(false);

    await migrateLegacyAuditLog();
    expect(await AuditLog.countDocuments()).toBe(2);
  });

  it('keeps a legacy record when the destination rejects its insert', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Test database is not connected');
    const legacyId = new Types.ObjectId();
    await AuditLog.deleteMany({});
    await AuditLog.create({
      action: 'stock.post.in',
      entityType: 'stock_movement',
      entityId: String(new Types.ObjectId()),
      at: new Date(),
    });
    const countBefore = await AuditLog.countDocuments();
    await AuditLog.collection.createIndex({ action: 1 }, { unique: true });
    await db.collection('audit_log').insertOne({
      _id: legacyId,
      action: 'stock.post.in',
      entityType: 'stock_movement',
      entityId: String(new Types.ObjectId()),
      at: new Date(),
    });

    await expect(migrateLegacyAuditLog()).rejects.toThrow();
    expect(await db.collection('audit_log').findOne({ _id: legacyId })).toBeTruthy();
    expect(await AuditLog.countDocuments()).toBe(countBefore);
  });
});
