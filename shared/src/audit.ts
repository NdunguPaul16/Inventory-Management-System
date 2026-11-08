import { z } from 'zod';
import { apiSuccessSchema } from './api.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const utcDate = z.iso.datetime({ offset: false }).regex(/Z$/, 'UTC timestamp required');

export const auditHistoryQuerySchema = z
  .strictObject({
    entity: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,79}$/)
      .optional(),
    entityId: objectId.optional(),
    user: objectId.optional(),
    action: z
      .string()
      .regex(/^[a-z][a-z0-9_.]{0,119}$/)
      .optional(),
    from: utcDate.optional(),
    to: utcDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['to'],
  });

export const auditHistoryParamsSchema = z.strictObject({ id: objectId });

export const auditEventSchema = z.strictObject({
  id: objectId,
  at: utcDate,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actorId: objectId.nullable(),
  summary: z.string(),
});

const safeDiffSchema = z.record(z.string(), z.unknown());
export const auditEventDetailSchema = auditEventSchema.extend({
  before: safeDiffSchema,
  after: safeDiffSchema,
  metadata: safeDiffSchema,
});

export const auditHistoryResponseSchema = apiSuccessSchema(z.array(auditEventSchema)).extend({
  meta: z.strictObject({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});
export const auditEventDetailResponseSchema = apiSuccessSchema(auditEventDetailSchema);

export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventDetail = z.infer<typeof auditEventDetailSchema>;
