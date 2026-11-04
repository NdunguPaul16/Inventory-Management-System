import { Router } from 'express';
import { createUserSchema, updateUserSchema, z } from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import { createUser, listUsers, updateUser } from './service.js';

const userParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });

function actorId(value: unknown): string {
  if (!value) throw AppError.unauthenticated();
  return String(value);
}

export const userRoutes = Router();
userRoutes.get('/', requirePermission('users.read'), async (_req, res) => {
  res.json({ data: await listUsers(), meta: {} });
});
userRoutes.post(
  '/',
  requirePermission('users.create'),
  validate({ body: createUserSchema }),
  async (_req, res) => {
    const result = await createUser(
      res.locals.validated!.body as never,
      actorId(res.locals.auth?.userId),
    );
    res.status(201).json({ data: result, meta: {} });
  },
);
userRoutes.patch(
  '/:id',
  requirePermission('users.update'),
  validate({ params: userParams, body: updateUserSchema }),
  async (_req, res) => {
    const params = res.locals.validated!.params as z.infer<typeof userParams>;
    const result = await updateUser(
      params.id,
      res.locals.validated!.body as never,
      actorId(res.locals.auth?.userId),
    );
    res.json({ data: result, meta: {} });
  },
);
