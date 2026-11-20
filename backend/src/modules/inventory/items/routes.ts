import { Router } from 'express';
import {
  createItemSchema,
  masterDataQuerySchema,
  objectIdSchema,
  updateItemSchema,
  z,
  type CreateItemInput,
  type MasterDataQuery,
  type UpdateItemInput,
} from '@ims/shared';
import { AppError } from '../../../lib/errors.js';
import { requirePermission } from '../../../middleware/require-permission.js';
import { validate } from '../../../middleware/validate.js';
import { createItem, getItem, listItems, updateItem } from './service.js';

const paramsSchema = z.object({ itemId: objectIdSchema });

export const itemRoutes = Router();

itemRoutes.get(
  '/',
  requirePermission('inventory.items.read'),
  validate({ query: masterDataQuerySchema }),
  async (_req, res) => {
    res.json({ data: await listItems(res.locals.validated?.query as MasterDataQuery), meta: {} });
  },
);

itemRoutes.get(
  '/:itemId',
  requirePermission('inventory.items.read'),
  validate({ params: paramsSchema }),
  async (_req, res) => {
    const { itemId } = res.locals.validated?.params as z.infer<typeof paramsSchema>;
    res.json({ data: await getItem(itemId), meta: {} });
  },
);

itemRoutes.post(
  '/',
  requirePermission('inventory.items.create'),
  validate({ body: createItemSchema }),
  async (_req, res) => {
    const actorId = res.locals.auth?.userId;
    if (!actorId) throw AppError.unauthenticated();
    const item = await createItem(res.locals.validated?.body as CreateItemInput, String(actorId));
    res.status(201).json({ data: item, meta: {} });
  },
);

itemRoutes.patch(
  '/:itemId',
  requirePermission('inventory.items.update'),
  validate({ params: paramsSchema, body: updateItemSchema }),
  async (_req, res) => {
    const actorId = res.locals.auth?.userId;
    if (!actorId) throw AppError.unauthenticated();
    const { itemId } = res.locals.validated?.params as z.infer<typeof paramsSchema>;
    const item = await updateItem(
      itemId,
      res.locals.validated?.body as UpdateItemInput,
      String(actorId),
    );
    res.json({ data: item, meta: {} });
  },
);
