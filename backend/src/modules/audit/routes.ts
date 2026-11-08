import { Router } from 'express';
import {
  auditHistoryParamsSchema,
  auditHistoryQuerySchema,
  type AuditHistoryQuery,
  type z,
} from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { getAuditEvent, listAuditHistory } from './read-service.js';

function actorId(value: unknown): string {
  if (!value) throw AppError.unauthenticated();
  return String(value);
}

export const auditRoutes = Router();
auditRoutes.get(
  '/',
  requirePermission('audit.read'),
  validate({ query: auditHistoryQuerySchema }),
  async (_req, res) => {
    res.json(
      await listAuditHistory(
        res.locals.validated!.query as AuditHistoryQuery,
        actorId(res.locals.auth?.userId),
      ),
    );
  },
);
auditRoutes.get(
  '/:id',
  requirePermission('audit.read'),
  validate({ params: auditHistoryParamsSchema }),
  async (_req, res) => {
    const { id } = res.locals.validated!.params as z.infer<typeof auditHistoryParamsSchema>;
    res.json(await getAuditEvent(id, actorId(res.locals.auth?.userId)));
  },
);
