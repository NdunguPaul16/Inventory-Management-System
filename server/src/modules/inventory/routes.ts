import { Router, type Request, type Response } from 'express';
import {
  adjustmentSchema,
  openingStockSchema,
  rejectStockActionSchema,
  reversalRequestSchema,
  stockActionQuerySchema,
  stockQuerySchema,
  transferSchema,
  z,
  type AdjustmentInput,
  type OpeningStockInput,
  type TransferStockInput,
} from '@ims/shared';
import {
  getFifoLayers,
  getMovementHistory,
  listStockBalances,
  reconcileBalances,
  transfer,
} from '../../engine/service.js';
import { AppError } from '../../lib/errors.js';
import { requireAuthenticated, requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import {
  approveStockAction,
  createStockAction,
  getStockAction,
  listStockActions,
  postStockAction,
  rejectStockAction,
} from './action-service.js';

const itemParams = z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) });
const movementParams = z.object({ movementId: z.string().regex(/^[a-f\d]{24}$/i) });
const requestParams = z.object({ requestId: z.string().regex(/^[a-f\d]{24}$/i) });

function actorId(res: Response) {
  const id = res.locals.auth?.userId;
  if (!id) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in is required');
  return String(id);
}

function idempotencyKey(req: Request) {
  const key = req.get('Idempotency-Key');
  if (!key) throw AppError.badRequest('Idempotency-Key header is required');
  return key;
}

function permissions(res: Response): readonly string[] {
  const granted = res.locals.auth?.permissions;
  if (!granted) throw AppError.unauthenticated();
  return granted;
}

export const inventoryRoutes = Router();

inventoryRoutes.get(
  '/balances',
  requirePermission('inventory.balances.read'),
  validate({ query: stockQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockQuerySchema>;
    res.json({ data: await listStockBalances(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/items/:itemId/layers',
  requirePermission('inventory.layers.read'),
  validate({
    params: itemParams,
    query: z.object({ locationId: z.string().regex(/^[a-f\d]{24}$/i) }),
  }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof itemParams>;
    const query = res.locals.validated?.query as { locationId: string };
    res.json({ data: await getFifoLayers(params.itemId, query.locationId), meta: {} });
  },
);

inventoryRoutes.get(
  '/items/:itemId/movements',
  requirePermission('inventory.movements.read'),
  validate({ params: itemParams, query: stockQuerySchema }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof itemParams>;
    const query = res.locals.validated?.query as z.infer<typeof stockQuerySchema>;
    const { itemId: _itemId, ...options } = query;
    res.json({ data: await getMovementHistory(params.itemId, options), meta: {} });
  },
);

inventoryRoutes.post(
  '/opening-stock',
  requirePermission('inventory.opening.request'),
  validate({ body: openingStockSchema }),
  async (_req, res) => {
    const body = res.locals.validated?.body as OpeningStockInput;
    const result = await createStockAction('OPENING', body, actorId(res), permissions(res));
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/adjustments',
  requirePermission('inventory.adjustments.request'),
  validate({ body: adjustmentSchema }),
  async (_req, res) => {
    const body = res.locals.validated?.body as AdjustmentInput;
    const result = await createStockAction('ADJUSTMENT', body, actorId(res), permissions(res));
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/transfers',
  requirePermission('inventory.transfers.post'),
  validate({ body: transferSchema }),
  async (req, res) => {
    const body = res.locals.validated?.body as TransferStockInput;
    const result = await transfer({
      ...body,
      postedBy: actorId(res),
      idempotencyKey: idempotencyKey(req),
    });
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/movements/:movementId/reverse',
  requirePermission('inventory.movements.reverse.request'),
  validate({ params: movementParams, body: reversalRequestSchema }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof movementParams>;
    const body = res.locals.validated?.body as z.infer<typeof reversalRequestSchema>;
    const result = await createStockAction(
      'REVERSAL',
      { movementId: params.movementId, reason: body.reason },
      actorId(res),
      permissions(res),
    );
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.get(
  '/requests',
  requirePermission('inventory.requests.read'),
  validate({ query: stockActionQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockActionQuerySchema>;
    res.json({ data: await listStockActions(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/requests/:requestId',
  requirePermission('inventory.requests.read'),
  validate({ params: requestParams }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof requestParams>;
    res.json({ data: await getStockAction(params.requestId), meta: {} });
  },
);

inventoryRoutes.post(
  '/requests/:requestId/approve',
  requireAuthenticated,
  validate({ params: requestParams }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof requestParams>;
    const result = await approveStockAction(params.requestId, actorId(res), permissions(res));
    res.json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/requests/:requestId/reject',
  requireAuthenticated,
  validate({ params: requestParams, body: rejectStockActionSchema }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof requestParams>;
    const body = res.locals.validated?.body as z.infer<typeof rejectStockActionSchema>;
    const result = await rejectStockAction(
      params.requestId,
      actorId(res),
      permissions(res),
      body.reason,
    );
    res.json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/requests/:requestId/post',
  requireAuthenticated,
  validate({ params: requestParams }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof requestParams>;
    const result = await postStockAction(params.requestId, actorId(res), permissions(res));
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.get(
  '/reconciliation',
  requirePermission('inventory.reconciliation.read'),
  async (_req, res) => {
    res.json({ data: await reconcileBalances(), meta: {} });
  },
);
