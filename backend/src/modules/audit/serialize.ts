import { Types } from 'mongoose';
import type { AuditEvent, AuditEventDetail } from '@ims/shared';
import type { AuditLogDoc } from './model.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
const SAFE_ACTIONS = new Set([
  'audit.history.read',
  'auth.login',
  'auth.login.failed',
  'auth.refresh',
  'auth.logout',
  'user.bootstrap',
  'user.create',
  'user.update',
  'role.seed',
  'role.seed.sync',
  'role.create',
  'role.update',
  'stock.post.in',
  'stock.post.out',
  'stock.reverse',
  'stock.action.request',
  'stock.action.approve',
  'stock.action.reject',
  'stock.action.post',
]);
const SAFE_ENTITIES = new Set([
  'audit_history',
  'authentication_attempt',
  'user',
  'role',
  'session',
  'stock_movement',
  'stock_action_request',
]);
const SENSITIVE_KEY =
  /password|hash|token|secret|cookie|authorization|credential|email|phone|address|request|body|session/i;
const BOOLEAN_FIELDS = new Set(['isActive', 'isSystem']);
const NUMBER_FIELDS = new Set(['failedLoginCount', 'quantity', 'availableQuantity', 'resultCount']);
const DECIMAL_FIELDS = new Set(['unitCost', 'totalCost']);
const ID_FIELDS = new Set(['itemId', 'locationId', 'sourceLocationId', 'destinationLocationId']);
const DATE_FIELDS = new Set(['lockedUntil']);
const CONTAINER_FIELDS = new Set(['changes', 'values']);

function safeIdentifier(value: unknown): string {
  const text = String(value ?? '');
  return OBJECT_ID.test(text) || text === 'unidentified' || text === 'list' ? text : '[redacted]';
}

function safeField(key: string, value: unknown, depth: number): unknown {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (BOOLEAN_FIELDS.has(key)) return typeof value === 'boolean' ? value : undefined;
  if (NUMBER_FIELDS.has(key))
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (DECIMAL_FIELDS.has(key)) {
    const text = String(value);
    return /^-?\d{1,16}(?:\.\d{1,8})?$/.test(text) ? text : undefined;
  }
  if (ID_FIELDS.has(key)) {
    const text = String(value);
    return OBJECT_ID.test(text) ? text : undefined;
  }
  if (DATE_FIELDS.has(key)) {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined;
  }
  if (key === 'roleIds' && Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map(String)
      .filter((id) => OBJECT_ID.test(id));
  }
  if (key === 'permissions' && Array.isArray(value)) {
    return value
      .slice(0, 250)
      .filter((item) => typeof item === 'string' && /^(?:\*|[a-z]+(?:\.[a-zA-Z*]+)+)$/.test(item));
  }
  if (key === 'filterNames' && Array.isArray(value)) {
    return [
      ...new Set(
        value.filter((item) =>
          ['entity', 'entityId', 'user', 'action', 'from', 'to'].includes(String(item)),
        ),
      ),
    ].slice(0, 6);
  }
  if (
    key === 'status' &&
    typeof value === 'string' &&
    ['PENDING', 'APPROVED', 'REJECTED', 'POSTED', 'IN_STOCK', 'ISSUED'].includes(value)
  )
    return value;
  if (key === 'source' && (value === 'cli' || value === 'startup')) return value;
  if (
    key === 'reason' &&
    typeof value === 'string' &&
    /^(?:unknown_account|inactive_account|locked_account|invalid_password|account_unavailable|credentials_changed)$/.test(
      value,
    )
  )
    return value;
  if (CONTAINER_FIELDS.has(key) && depth < 3) return safeRecord(value, depth + 1);
  return undefined;
}

/** Unknown and personal fields are omitted, including in older migrated Mixed payloads. */
export function safeRecord(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const safe = safeField(key, item, depth);
      return safe === undefined ? [] : [[key, safe]];
    }),
  );
}

export function serializeAuditEvent(record: AuditLogDoc): AuditEvent {
  const action = SAFE_ACTIONS.has(record.action) ? record.action : '[redacted]';
  const entityType = SAFE_ENTITIES.has(record.entityType) ? record.entityType : '[redacted]';
  return {
    id: String(record._id),
    at: record.at.toISOString(),
    action,
    entityType,
    entityId: safeIdentifier(record.entityId),
    actorId: record.actorId instanceof Types.ObjectId ? String(record.actorId) : null,
    summary: action === 'auth.login.failed' ? 'Unsuccessful sign-in attempt' : `Recorded ${action}`,
  };
}

export function serializeAuditDetail(record: AuditLogDoc): AuditEventDetail {
  return {
    ...serializeAuditEvent(record),
    before: safeRecord(record.before),
    after: safeRecord(record.after),
    metadata: safeRecord(record.metadata),
  };
}
