import { Router, type Request, type Response } from 'express';
import {
  adjustmentSchema,
  enterStockCountSchema,
  enterSerialStockCountSchema,
  freezeStockCountSchema,
  openingStockSchema,
  openingStockBatchSchema,
  openingStockImportSchema,
  rejectStockCountSchema,
  rejectStockActionSchema,
  reversalRequestSchema,
  stockActionQuerySchema,
  stockCountQuerySchema,
  stockCountOptionQuerySchema,
  stockReferenceQuerySchema,
  stockQuerySchema,
  stockValuationQuerySchema,
  transferSchema,
  z,
  type AdjustmentInput,
  type OpeningStockInput,
  type OpeningStockBatchInput,
  type OpeningStockImportInput,
  type TransferStockInput,
} from '@ims/shared';
import {
  getFifoLayers,
  getMovementHistory,
  listStockBalances,
  reconcileBalances,
  transfer,
} from './engine/service.js';
import { AppError } from '../../lib/errors.js';
import { requireAnyPermission, requirePermission } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import {
  approveStockAction,
  createStockAction,
  createOpeningImport,
  getStockAction,
  listStockActions,
  postStockAction,
  rejectStockAction,
} from './action-service.js';
import {
  approveStockCount,
  enterStockCount,
  enterSerialStockCount,
  freezeStockCount,
  getStockCount,
  listStockCounts,
  postStockCount,
  rejectStockCount,
} from './count-service.js';
import { listActiveStockItems, listCountableItems, listCountLocations } from './count-options.js';
import { getStockValuationAsAt } from './valuation-service.js';

const itemParams = z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) });
const movementParams = z.object({ movementId: z.string().regex(/^[a-f\d]{24}$/i) });
const requestParams = z.object({ requestId: z.string().regex(/^[a-f\d]{24}$/i) });
const countParams = z.object({ countId: z.string().regex(/^[a-f\d]{24}$/i) });

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

const canSelectStockReferences = requireAnyPermission(
  'inventory.opening.request',
  'inventory.adjustments.request',
  'inventory.transfers.post',
  'inventory.counts.freeze',
);

inventoryRoutes.get(
  '/options/items',
  canSelectStockReferences,
  validate({ query: stockReferenceQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockReferenceQuerySchema>;
    res.json({ data: await listActiveStockItems(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/options/locations',
  canSelectStockReferences,
  validate({ query: stockReferenceQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockReferenceQuerySchema>;
    res.json({ data: await listCountLocations(query), meta: {} });
  },
);

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
  '/valuation',
  requirePermission('inventory.valuation.read'),
  validate({ query: stockValuationQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockValuationQuerySchema>;
    res.json({ data: await getStockValuationAsAt(query), meta: { asAt: query.asAt } });
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
  '/opening-stock/batches',
  requirePermission('inventory.opening.request'),
  validate({ body: openingStockBatchSchema }),
  async (_req, res) => {
    const body = res.locals.validated?.body as OpeningStockBatchInput;
    const result = await createStockAction('OPENING_BATCH', body, actorId(res), permissions(res));
    res.status(201).json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/opening-stock/imports',
  requirePermission('inventory.opening.request'),
  validate({ body: openingStockImportSchema }),
  async (_req, res) => {
    const body = res.locals.validated?.body as OpeningStockImportInput;
    const result = await createOpeningImport(body, actorId(res), permissions(res));
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
  requireAnyPermission(
    'inventory.opening.approve',
    'inventory.adjustments.approve',
    'inventory.movements.reverse.approve',
  ),
  validate({ params: requestParams }),
  async (_req, res) => {
    const params = res.locals.validated?.params as z.infer<typeof requestParams>;
    const result = await approveStockAction(params.requestId, actorId(res), permissions(res));
    res.json({ data: result, meta: {} });
  },
);

inventoryRoutes.post(
  '/requests/:requestId/reject',
  requireAnyPermission(
    'inventory.opening.approve',
    'inventory.adjustments.approve',
    'inventory.movements.reverse.approve',
  ),
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
  requireAnyPermission(
    'inventory.opening.post',
    'inventory.adjustments.post',
    'inventory.movements.reverse.post',
  ),
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

inventoryRoutes.get(
  '/counts',
  requirePermission('inventory.counts.read'),
  validate({ query: stockCountQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockCountQuerySchema>;
    res.json({ data: await listStockCounts(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/counts/options/items',
  requirePermission('inventory.counts.freeze'),
  validate({ query: stockCountOptionQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockCountOptionQuerySchema>;
    res.json({ data: await listCountableItems(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/counts/options/locations',
  requirePermission('inventory.counts.freeze'),
  validate({ query: stockCountOptionQuerySchema }),
  async (_req, res) => {
    const query = res.locals.validated?.query as z.infer<typeof stockCountOptionQuerySchema>;
    res.json({ data: await listCountLocations(query), meta: {} });
  },
);

inventoryRoutes.get(
  '/counts/:countId',
  requirePermission('inventory.counts.read'),
  validate({ params: countParams }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    res.json({ data: await getStockCount(countId), meta: {} });
  },
);

inventoryRoutes.post(
  '/counts',
  requirePermission('inventory.counts.freeze'),
  validate({ body: freezeStockCountSchema }),
  async (_req, res) => {
    const body = res.locals.validated?.body as z.infer<typeof freezeStockCountSchema>;
    res.status(201).json({ data: await freezeStockCount(body, actorId(res)), meta: {} });
  },
);

inventoryRoutes.patch(
  '/counts/:countId/entry',
  requirePermission('inventory.counts.enter'),
  validate({ params: countParams, body: enterStockCountSchema }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    const body = res.locals.validated?.body as z.infer<typeof enterStockCountSchema>;
    res.json({ data: await enterStockCount(countId, body, actorId(res)), meta: {} });
  },
);

inventoryRoutes.patch(
  '/counts/:countId/serial-entry',
  requirePermission('inventory.counts.enter'),
  validate({ params: countParams, body: enterSerialStockCountSchema }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    const body = res.locals.validated?.body as z.infer<typeof enterSerialStockCountSchema>;
    res.json({ data: await enterSerialStockCount(countId, body, actorId(res)), meta: {} });
  },
);

inventoryRoutes.post(
  '/counts/:countId/approve',
  requirePermission('inventory.counts.approve'),
  validate({ params: countParams }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    res.json({ data: await approveStockCount(countId, actorId(res)), meta: {} });
  },
);

inventoryRoutes.post(
  '/counts/:countId/reject',
  requirePermission('inventory.counts.approve'),
  validate({ params: countParams, body: rejectStockCountSchema }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    const { reason } = res.locals.validated?.body as z.infer<typeof rejectStockCountSchema>;
    res.json({ data: await rejectStockCount(countId, actorId(res), reason), meta: {} });
  },
);

inventoryRoutes.post(
  '/counts/:countId/post',
  requirePermission('inventory.counts.post'),
  validate({ params: countParams }),
  async (_req, res) => {
    const { countId } = res.locals.validated?.params as z.infer<typeof countParams>;
    res.status(201).json({ data: await postStockCount(countId, actorId(res)), meta: {} });
  },
);
