import mongoose, { type Types } from 'mongoose';
import { AuditLog } from './model.js';

/** Move records written by the earlier stock engine into the shared audit collection. */
export async function migrateLegacyAuditLog(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db || !(await db.listCollections({ name: 'audit_log' }).hasNext())) return;

  await AuditLog.createCollection();
  const legacy = db.collection('audit_log');
  for await (const entry of legacy.find()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await AuditLog.collection.updateOne(
          { _id: entry._id as Types.ObjectId },
          {
            $setOnInsert: {
              actorId: entry.actorId,
              action: entry.action,
              entityType: entry.entityType,
              entityId: String(entry.entityId),
              at: entry.at,
              metadata: entry.details ?? {},
            },
          },
          { upsert: true, session },
        );
        await legacy.deleteOne({ _id: entry._id }, { session });
      });
    } finally {
      await session.endSession();
    }
  }
  if ((await legacy.countDocuments()) === 0) await legacy.drop();
}
