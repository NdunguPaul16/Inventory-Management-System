import mongoose, { Types } from 'mongoose';
import { Decimal } from 'decimal.js';
import type {
  AdjustmentInput,
  OpeningStockBatchInput,
  OpeningStockImportInput,
  OpeningStockInput,
} from '@ims/shared';
import {
  postAdjustment,
  postOpeningStock,
  postOpeningStockBatch,
  reverse,
  type PostingHook,
} from './engine/service.js';
import { StockMovement } from './engine/models.js';
import type { MovementResult, SourceDocument } from './engine/types.js';
import { AppError } from '../../lib/errors.js';
import { hasPermission } from '../../middleware/require-permission.js';
import { writeAuditLog } from '../audit/service.js';
import { nextDocumentNumber } from '../counters/service.js';
import { StockAction, type StockActionDoc, type StockActionType } from './action-model.js';
import { Item } from './items/model.js';
import { Location } from './locations/model.js';
import { assertRepresentableStockQuantity } from './quantity.js';

type ReversalRequest = { movementId: string; reason: string };
type ActionPayload = OpeningStockInput | OpeningStockBatchInput | AdjustmentInput | ReversalRequest;
type ActionOperation = 'request' | 'approve' | 'post';

/** Filter by action type before lookup so an unapproved request cannot be enumerated. */
export function permittedStockActionTypes(
  permissions: readonly string[],
  operation: 'approve' | 'post',
): StockActionType[] {
  return (['OPENING', 'OPENING_BATCH', 'ADJUSTMENT', 'REVERSAL'] as const).filter((actionType) => {
    const area =
      actionType === 'OPENING' || actionType === 'OPENING_BATCH'
        ? 'opening'
        : actionType === 'ADJUSTMENT'
          ? 'adjustments'
          : 'movements.reverse';
    return hasPermission(permissions, `inventory.${area}.${operation}`);
  });
}

function id(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw AppError.badRequest(`${field} must be a valid id`);
  return new Types.ObjectId(value);
}

function requireActionPermission(
  permissions: readonly string[],
  actionType: StockActionType,
  operation: ActionOperation,
): void {
  const area =
    actionType === 'OPENING' || actionType === 'OPENING_BATCH'
      ? 'opening'
      : actionType === 'ADJUSTMENT'
        ? 'adjustments'
        : 'movements.reverse';
  if (!hasPermission(permissions, `inventory.${area}.${operation}`)) throw AppError.forbidden();
}

function publicAction(action: StockActionDoc) {
  return {
    id: String(action._id),
    actionNo: action.actionNo,
    actionType: action.actionType,
    status: action.status,
    payload: action.payload,
    requestedBy: String(action.requestedBy),
    approvedBy: action.approvedBy ? String(action.approvedBy) : null,
    approvedAt: action.approvedAt?.toISOString() ?? null,
    rejectedBy: action.rejectedBy ? String(action.rejectedBy) : null,
    rejectedAt: action.rejectedAt?.toISOString() ?? null,
    rejectionReason: action.rejectionReason ?? null,
    postedBy: action.postedBy ? String(action.postedBy) : null,
    postedAt: action.postedAt?.toISOString() ?? null,
    movementIds: action.movementIds.map(String),
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };
}

export async function createStockAction(
  actionType: StockActionType,
  payload: ActionPayload,
  actorId: string,
  permissions: readonly string[],
) {
  requireActionPermission(permissions, actionType, 'request');
  const requester = id(actorId, 'actorId');
  if (actionType === 'OPENING' || actionType === 'ADJUSTMENT') {
    assertRepresentableStockQuantity((payload as OpeningStockInput | AdjustmentInput).quantity);
  } else if (actionType === 'OPENING_BATCH') {
    for (const line of (payload as OpeningStockBatchInput).lines) {
      assertRepresentableStockQuantity(line.quantity);
    }
  }
  if (actionType === 'REVERSAL') {
    const movementId = id((payload as ReversalRequest).movementId, 'movementId');
    if (!(await StockMovement.exists({ _id: movementId }))) {
      throw AppError.notFound('Stock movement not found');
    }
  }
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const actionNo = await nextDocumentNumber('STKACT', { session });
      const [action] = await StockAction.create(
        [
          {
            actionNo,
            actionType,
            payload,
            requestedBy: requester,
          },
        ],
        { session },
      );
      if (!action) throw new Error('Stock action request was not created');
      await writeAuditLog({
        actorId: requester,
        action: 'stock.action.request',
        entityType: 'stock_action_request',
        entityId: action._id,
        after: publicAction(action),
        session,
      });
      return publicAction(action);
    });
    if (!result) throw new Error('Stock action request transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

/** Resolve human sheet references before a single reviewed batch request is persisted. */
export async function createOpeningImport(
  input: OpeningStockImportInput,
  actorId: string,
  permissions: readonly string[],
) {
  requireActionPermission(permissions, 'OPENING_BATCH', 'request');
  const skus = [...new Set(input.lines.map((line) => line.sku.toUpperCase()))];
  const codes = [...new Set(input.lines.map((line) => line.locationCode.toUpperCase()))];
  const [items, locations] = await Promise.all([
    Item.find({ sku: { $in: skus }, isActive: true, type: { $ne: 'SERVICE' } }).lean(),
    Location.find({ code: { $in: codes }, isActive: true }).lean(),
  ]);
  const bySku = new Map(items.map((item) => [item.sku, item]));
  const byCode = new Map(locations.map((location) => [location.code, location]));
  const batchSerials = new Set<string>();
  const lines = input.lines.map(({ sku, locationCode, ...line }) => {
    const item = bySku.get(sku.toUpperCase());
    const location = byCode.get(locationCode.toUpperCase());
    if (!item || !location) {
      throw AppError.badRequest(
        `Line ${line.lineId}: active stock item SKU or location code was not found`,
      );
    }
    const serials = (line.serialNumbers ?? []).map((serial) => serial.toUpperCase());
    if (item.trackSerial) {
      const quantity = new Decimal(line.quantity);
      if (
        !quantity.isInteger() ||
        quantity.greaterThan(Number.MAX_SAFE_INTEGER) ||
        serials.length !== quantity.toNumber()
      ) {
        throw AppError.badRequest(`Line ${line.lineId}: enter one serial number per whole unit`);
      }
    } else if (serials.length) {
      throw AppError.badRequest(`Line ${line.lineId}: this item does not track serial numbers`);
    }
    for (const serial of serials) {
      if (batchSerials.has(serial)) {
        throw AppError.badRequest(`Line ${line.lineId}: duplicate serial number in import`);
      }
      batchSerials.add(serial);
    }
    return {
      ...line,
      sku: item.sku,
      locationCode: location.code,
      itemId: String(item._id),
      locationId: String(location._id),
    };
  });
  return createStockAction(
    'OPENING_BATCH',
    { sourceDoc: input.sourceDoc, lines },
    actorId,
    permissions,
  );
}

export async function listStockActions(options: {
  actionType?: StockActionType;
  status?: StockActionDoc['status'];
  before?: string;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  if (options.actionType) filter.actionType = options.actionType;
  if (options.status) filter.status = options.status;
  if (options.before) filter._id = { $lt: id(options.before, 'before') };
  const actions = await StockAction.find(filter).sort({ _id: -1 }).limit(options.limit);
  return actions.map(publicAction);
}

export async function getStockAction(actionId: string) {
  const action = await StockAction.findById(id(actionId, 'actionId'));
  if (!action) throw AppError.notFound('Stock action request not found');
  return publicAction(action);
}

export async function approveStockAction(
  actionId: string,
  actorId: string,
  permissions: readonly string[],
) {
  const permittedTypes = permittedStockActionTypes(permissions, 'approve');
  if (permittedTypes.length === 0) throw AppError.forbidden();
  const approver = id(actorId, 'actorId');
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const action = await StockAction.findOne({
        _id: id(actionId, 'actionId'),
        actionType: { $in: permittedTypes },
      }).session(session);
      if (!action) throw AppError.notFound('Stock action request not found');
      requireActionPermission(permissions, action.actionType, 'approve');
      if (action.status !== 'PENDING_APPROVAL')
        throw AppError.conflict('Request is not pending approval');
      let bootstrapOverride = false;
      if (action.requestedBy.equals(approver)) {
        const operationalStockExists = await StockMovement.exists({
          movementType: { $ne: 'OPENING' },
        }).session(session);
        bootstrapOverride =
          permissions.includes('*') &&
          (action.actionType === 'OPENING' || action.actionType === 'OPENING_BATCH') &&
          !operationalStockExists;
        if (!bootstrapOverride)
          throw AppError.forbidden('A different authorised user must approve this request');
      }
      const before = publicAction(action);
      action.status = 'APPROVED';
      action.approvedBy = approver;
      action.approvedAt = new Date();
      await action.save({ session });
      const approved = publicAction(action);
      await writeAuditLog({
        actorId: approver,
        action: 'stock.action.approve',
        entityType: 'stock_action_request',
        entityId: action._id,
        before,
        after: approved,
        ...(bootstrapOverride ? { metadata: { bootstrapOverride: 'initial-opening-stock' } } : {}),
        session,
      });
      return approved;
    });
    if (!result) throw new Error('Approval transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

export async function rejectStockAction(
  actionId: string,
  actorId: string,
  permissions: readonly string[],
  reason: string,
) {
  const permittedTypes = permittedStockActionTypes(permissions, 'approve');
  if (permittedTypes.length === 0) throw AppError.forbidden();
  const approver = id(actorId, 'actorId');
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const action = await StockAction.findOne({
        _id: id(actionId, 'actionId'),
        actionType: { $in: permittedTypes },
      }).session(session);
      if (!action) throw AppError.notFound('Stock action request not found');
      requireActionPermission(permissions, action.actionType, 'approve');
      if (action.status !== 'PENDING_APPROVAL')
        throw AppError.conflict('Request is not pending approval');
      const before = publicAction(action);
      action.status = 'REJECTED';
      action.rejectedBy = approver;
      action.rejectedAt = new Date();
      action.rejectionReason = reason;
      await action.save({ session });
      const rejected = publicAction(action);
      await writeAuditLog({
        actorId: approver,
        action: 'stock.action.reject',
        entityType: 'stock_action_request',
        entityId: action._id,
        before,
        after: rejected,
        session,
      });
      return rejected;
    });
    if (!result) throw new Error('Rejection transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

function actionSource(action: StockActionDoc): SourceDocument {
  return {
    type: `STOCK_${action.actionType}`,
    id: String(action._id),
    number: action.actionNo,
  };
}

async function postApprovedAction(
  action: StockActionDoc,
  actorId: string,
  onPosted: PostingHook,
): Promise<MovementResult> {
  const sourceDoc = actionSource(action);
  const posting = { postedBy: actorId, idempotencyKey: `stock-action:${action._id}` };
  if (action.actionType === 'OPENING') {
    const payload = action.payload as unknown as OpeningStockInput;
    return postOpeningStock(
      {
        itemId: payload.itemId,
        locationId: payload.locationId,
        quantity: payload.quantity,
        unitCost: payload.unitCost,
        sourceDoc,
        serialNumbers: payload.serialNumbers,
        ...(payload.receivedAt ? { receivedAt: new Date(payload.receivedAt) } : {}),
        ...posting,
      },
      onPosted,
    );
  }
  if (action.actionType === 'OPENING_BATCH') {
    const payload = action.payload as unknown as OpeningStockBatchInput;
    return postOpeningStockBatch(
      payload.lines.map((line) => ({
        itemId: line.itemId,
        locationId: line.locationId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        sourceDoc: { ...sourceDoc, lineId: line.lineId },
        postedBy: actorId,
        ...(line.receivedAt ? { receivedAt: new Date(line.receivedAt) } : {}),
        ...(line.serialNumbers ? { serialNumbers: line.serialNumbers } : {}),
      })),
      posting.idempotencyKey,
      onPosted,
    );
  }
  if (action.actionType === 'ADJUSTMENT') {
    const payload = action.payload as unknown as AdjustmentInput;
    return postAdjustment(
      {
        itemId: payload.itemId,
        locationId: payload.locationId,
        quantity: payload.quantity,
        direction: payload.direction,
        unitCost: payload.unitCost,
        reason: payload.reason,
        sourceDoc,
        serialNumbers: payload.serialNumbers,
        ...posting,
      },
      onPosted,
    );
  }
  const payload = action.payload as unknown as ReversalRequest;
  return reverse(
    {
      movementId: payload.movementId,
      postedBy: actorId,
      idempotencyKey: posting.idempotencyKey,
      approvalDoc: sourceDoc,
      reason: payload.reason,
    },
    onPosted,
  );
}

export async function postStockAction(
  actionId: string,
  actorId: string,
  permissions: readonly string[],
) {
  const permittedTypes = permittedStockActionTypes(permissions, 'post');
  if (permittedTypes.length === 0) throw AppError.forbidden();
  const action = await StockAction.findOne({
    _id: id(actionId, 'actionId'),
    actionType: { $in: permittedTypes },
  });
  if (!action) throw AppError.notFound('Stock action request not found');
  requireActionPermission(permissions, action.actionType, 'post');
  if (action.status !== 'APPROVED' && action.status !== 'POSTED') {
    throw AppError.conflict('Request must be approved before posting');
  }
  if (!action.approvedBy?.equals(id(actorId, 'actorId'))) {
    throw AppError.forbidden('The approver must post this request');
  }
  if (action.status === 'POSTED') {
    const movements = await StockMovement.find({ _id: { $in: action.movementIds } }).sort({
      postedAt: 1,
      _id: 1,
    });
    return {
      request: publicAction(action),
      posting: {
        movementIds: movements.map((movement) => String(movement._id)),
        movements: movements.map((movement) => ({
          id: String(movement._id),
          movementNo: movement.movementNo,
          direction: movement.direction,
          quantity: movement.quantity.toString(),
          totalCost: movement.totalCost,
        })),
        replayed: true,
      },
    };
  }

  const onPosted: PostingHook = async (movements, session) => {
    const current = await StockAction.findById(action._id).session(session);
    if (!current || current.status !== 'APPROVED') {
      throw AppError.conflict('Request changed while posting');
    }
    if (!current.approvedBy?.equals(id(actorId, 'actorId'))) {
      throw AppError.forbidden('The approver must post this request');
    }
    const before = publicAction(current);
    current.status = 'POSTED';
    current.postedBy = id(actorId, 'actorId');
    current.postedAt = new Date();
    current.movementIds = movements.map((movement) => movement._id);
    await current.save({ session });
    const posted = publicAction(current);
    await writeAuditLog({
      actorId,
      action: 'stock.action.post',
      entityType: 'stock_action_request',
      entityId: current._id,
      before,
      after: posted,
      session,
    });
  };
  const posting = await postApprovedAction(action, actorId, onPosted);
  const request = await getStockAction(actionId);
  if (request.status !== 'POSTED') throw AppError.conflict('Posting record is incomplete');
  return { request, posting };
}
