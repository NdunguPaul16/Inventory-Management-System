import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { auditHistoryQuerySchema, type AuditHistoryQuery, z } from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { AuditLog } from './model.js';
import { serializeAuditDetail, serializeAuditEvent } from './serialize.js';
import { writeAuditLog } from './service.js';

const CURSOR_SCHEMA = z.strictObject({
  v: z.literal(1),
  at: z.iso.datetime(),
  id: z.string().regex(/^[a-f\d]{24}$/i),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  filters: z.string().regex(/^[a-f\d]{64}$/),
});
type Cursor = z.infer<typeof CURSOR_SCHEMA>;

function filterFingerprint(query: AuditHistoryQuery): string {
  return createHash('sha256')
    .update(JSON.stringify([query.entity, query.entityId, query.user, query.action]))
    .digest('hex');
}

function decodeCursor(encoded: string, query: AuditHistoryQuery): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Bad cursor alphabet');
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== encoded) throw new Error('Bad cursor encoding');
    const cursor = CURSOR_SCHEMA.parse(JSON.parse(json));
    if (
      cursor.filters !== filterFingerprint(query) ||
      (query.from && query.from !== cursor.from) ||
      (query.to && query.to !== cursor.to) ||
      cursor.from > cursor.to ||
      cursor.at > cursor.to
    )
      throw new Error('Cursor does not match filters');
    return cursor;
  } catch {
    throw AppError.badRequest('Invalid audit-history cursor');
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function filterNames(query: AuditHistoryQuery): string[] {
  return (['entity', 'entityId', 'user', 'action', 'from', 'to'] as const).filter(
    (key) => query[key] !== undefined,
  );
}

/** A single safe read event is written before any history is released. */
async function auditRead(actorId: string, recordId: string, names: string[], resultCount: number) {
  await writeAuditLog({
    actorId,
    action: 'audit.history.read',
    entityType: 'audit_history',
    entityId: recordId,
    metadata: { filterNames: names, resultCount },
  });
}

export async function listAuditHistory(rawQuery: AuditHistoryQuery, actorId: string) {
  const query = auditHistoryQuerySchema.parse(rawQuery);
  const cursor = query.cursor ? decodeCursor(query.cursor, query) : null;
  const to = cursor?.to ?? query.to ?? new Date().toISOString();
  const from =
    cursor?.from ?? query.from ?? new Date(Date.parse(to) - 30 * 24 * 60 * 60_000).toISOString();
  if (from > to) throw AppError.badRequest('from must not be after to');

  const conditions: Record<string, unknown>[] = [
    { at: { $gte: new Date(from), $lte: new Date(to) } },
  ];
  if (query.entity) conditions.push({ entityType: query.entity });
  if (query.entityId) conditions.push({ entityId: query.entityId });
  if (query.action) conditions.push({ action: query.action });
  if (query.user)
    conditions.push({
      $or: [
        { actorId: new Types.ObjectId(query.user) },
        { entityType: 'user', entityId: query.user },
      ],
    });
  if (cursor)
    conditions.push({
      $or: [
        { at: { $lt: new Date(cursor.at) } },
        { at: new Date(cursor.at), _id: { $lt: new Types.ObjectId(cursor.id) } },
      ],
    });

  const rows = await AuditLog.find({ $and: conditions })
    .select('_id at action entityType entityId actorId')
    .sort({ at: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean();
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          at: last.at.toISOString(),
          id: String(last._id),
          from,
          to,
          filters: filterFingerprint(query),
        })
      : null;
  const data = page.map(serializeAuditEvent);
  await auditRead(actorId, 'list', filterNames(query), data.length);
  return { data, meta: { nextCursor, hasMore } };
}

export async function getAuditEvent(id: string, actorId: string) {
  const record = await AuditLog.findById(id).lean();
  const data = record ? serializeAuditDetail(record) : null;
  await auditRead(actorId, id, [], data ? 1 : 0);
  if (!data) throw AppError.notFound('Audit event not found');
  return { data, meta: {} };
}
