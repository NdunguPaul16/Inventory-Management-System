import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';

describe('audit-history compound index', () => {
  it('uses the at/_id index for a representative 20,000-event history page', async () => {
    const db = AuditLog.db.db;
    if (!db) throw new Error('Test database is not connected');
    await AuditLog.createCollection();
    await AuditLog.syncIndexes();
    const indexes = await db.collection('audit_logs').indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'at_-1__id_-1', key: { at: -1, _id: -1 } }),
      ]),
    );

    const now = Date.now();
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      _id: new Types.ObjectId(),
      at: new Date(now - i * 1_000),
      action: 'user.update',
      entityType: 'user',
      entityId: String(new Types.ObjectId()),
    }));
    await db.collection('audit_logs').insertMany(rows, { ordered: false });
    const plan = await db
      .collection('audit_logs')
      .find({ at: { $gte: new Date(now - 30 * 24 * 60 * 60_000), $lte: new Date(now) } })
      .sort({ at: -1, _id: -1 })
      .limit(50)
      .explain('executionStats');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('at_-1__id_-1');
    expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(50);
    expect(plan.executionStats.totalKeysExamined).toBeLessThanOrEqual(51);
  });
});
