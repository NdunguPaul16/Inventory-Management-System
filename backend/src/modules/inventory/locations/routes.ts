import { Router } from 'express';
import {
  createLocationSchema,
  masterDataQuerySchema,
  objectIdSchema,
  updateLocationSchema,
  z,
  type CreateLocationInput,
  type MasterDataQuery,
  type UpdateLocationInput,
} from '@ims/shared';
import { AppError } from '../../../lib/errors.js';
import { requirePermission } from '../../../middleware/require-permission.js';
import { validate } from '../../../middleware/validate.js';
import { createLocation, getLocation, listLocations, updateLocation } from './service.js';

const paramsSchema = z.object({ locationId: objectIdSchema });

export const locationRoutes = Router();

locationRoutes.get(
  '/',
  requirePermission('inventory.locations.read'),
  validate({ query: masterDataQuerySchema }),
  async (_req, res) => {
    res.json({
      data: await listLocations(res.locals.validated?.query as MasterDataQuery),
      meta: {},
    });
  },
);

locationRoutes.get(
  '/:locationId',
  requirePermission('inventory.locations.read'),
  validate({ params: paramsSchema }),
  async (_req, res) => {
    const { locationId } = res.locals.validated?.params as z.infer<typeof paramsSchema>;
    res.json({ data: await getLocation(locationId), meta: {} });
  },
);

locationRoutes.post(
  '/',
  requirePermission('inventory.locations.create'),
  validate({ body: createLocationSchema }),
  async (_req, res) => {
    const actorId = res.locals.auth?.userId;
    if (!actorId) throw AppError.unauthenticated();
    const location = await createLocation(
      res.locals.validated?.body as CreateLocationInput,
      String(actorId),
    );
    res.status(201).json({ data: location, meta: {} });
  },
);

locationRoutes.patch(
  '/:locationId',
  requirePermission('inventory.locations.update'),
  validate({ params: paramsSchema, body: updateLocationSchema }),
  async (_req, res) => {
    const actorId = res.locals.auth?.userId;
    if (!actorId) throw AppError.unauthenticated();
    const { locationId } = res.locals.validated?.params as z.infer<typeof paramsSchema>;
    const location = await updateLocation(
      locationId,
      res.locals.validated?.body as UpdateLocationInput,
      String(actorId),
    );
    res.json({ data: location, meta: {} });
  },
);
