import { Router } from 'express';
import { createRoleSchema, updateRoleSchema, z } from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { createRole, listRoles, updateRole } from './service.js';

const roleParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
function actorId(value: unknown): string {
  if (!value) throw AppError.unauthenticated();
  return String(value);
}

export const roleRoutes = Router();
roleRoutes.get('/', requirePermission('roles.read'), async (_req, res) => {
  res.json({ data: await listRoles(), meta: {} });
});
roleRoutes.post(
  '/',
  requirePermission('roles.create'),
  validate({ body: createRoleSchema }),
  async (_req, res) => {
    const result = await createRole(
      res.locals.validated!.body as never,
      actorId(res.locals.auth?.userId),
    );
    res.status(201).json({ data: result, meta: {} });
  },
);
roleRoutes.patch(
  '/:id',
  requirePermission('roles.update'),
  validate({ params: roleParams, body: updateRoleSchema }),
  async (_req, res) => {
    const params = res.locals.validated!.params as z.infer<typeof roleParams>;
    const result = await updateRole(
      params.id,
      res.locals.validated!.body as never,
      actorId(res.locals.auth?.userId),
    );
    res.json({ data: result, meta: {} });
  },
);
