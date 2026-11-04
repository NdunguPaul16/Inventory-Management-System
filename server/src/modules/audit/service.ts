import { Types, type ClientSession } from 'mongoose';
import { AuditLog } from './model.js';

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'secret',
]);

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return String(value);
  if (value instanceof Types.Decimal128) return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_FIELDS.has(key.toLowerCase()))
        .map(([key, field]) => [key, sanitizeValue(field)]),
    );
  }
  return value;
}

function sanitize(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value ? (sanitizeValue(value) as Record<string, unknown>) : undefined;
}

export async function writeAuditLog(input: {
  actorId?: string | Types.ObjectId;
  action: string;
  entityType: string;
  entityId: string | Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  session?: ClientSession;
}): Promise<void> {
  const before = sanitize(input.before);
  const after = sanitize(input.after);
  const metadata = sanitize(input.metadata);
  await AuditLog.create(
    [
      {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        action: input.action,
        entityType: input.entityType,
        entityId: String(input.entityId),
        at: new Date(),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(metadata ? { metadata } : {}),
      },
    ],
    input.session ? { session: input.session } : {},
  );
}
