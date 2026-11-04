import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../modules/audit/service.js';
import { Item } from '../modules/items/model.js';
import { Location } from '../modules/locations/model.js';
import { nextDocumentNumber } from '../modules/counters/service.js';
import {
  CostLayer,
  PostingRequest,
  SerialNumber,
  StockBalance,
  StockMovement,
  type CostLayerDoc,
  type LayerSlice,
  type StockMovementDoc,
} from './models.js';
import type {
  MovementResult,
  PostInput,
  SourceDocument,
  StockMovementType,
  TransferInput,
} from './types.js';

const Quantity = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const IN_TYPES = new Set<StockMovementType>([
  'OPENING',
  'GRN',
  'PRODUCTION_RECEIPT',
  'SALE_RETURN',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'COUNT_VARIANCE',
]);
const OUT_TYPES = new Set<StockMovementType>([
  'PRODUCTION_ISSUE',
  'SALE',
  'PURCHASE_RETURN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'COUNT_VARIANCE',
]);

export type PostingHook = (movements: StockMovementDoc[], session: ClientSession) => Promise<void>;

function parseQuantity(value: string): Decimal {
  let quantity: Decimal;
  try {
    quantity = new Quantity(value);
  } catch {
    throw AppError.badRequest('Quantity must be a valid decimal number');
  }
  if (!quantity.isFinite() || !quantity.greaterThan(0)) {
    throw AppError.badRequest('Quantity must be greater than zero');
  }
  return quantity;
}

function objectId(value: string | Types.ObjectId, field: string): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(value))
    throw AppError.badRequest(`${field} must be a valid object id`);
  return new Types.ObjectId(value);
}

function validateSource(source: SourceDocument): void {
  if (!source.type.trim() || !source.id.trim() || !source.number.trim()) {
    throw AppError.badRequest('Source document type, id and number are required');
  }
}

function validateIdempotencyKey(key: string): void {
  if (!key || key.length > 200 || !/^[\w.:-]+$/.test(key)) {
    throw AppError.badRequest(
      'Idempotency key must be 1–200 letters, numbers, dots, colons or hyphens',
    );
  }
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Types.ObjectId)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value instanceof Types.ObjectId ? value.toHexString() : value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function decimal128(value: Decimal): Types.Decimal128 {
  return Types.Decimal128.fromString(value.toString());
}

function cents(value: Decimal): number {
  const rounded = value.toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw AppError.badRequest('Stock value exceeds the supported whole-cent range');
  }
  return rounded;
}

function addCents(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum))
    throw AppError.badRequest('Stock value exceeds the supported whole-cent range');
  return sum;
}

function asDecimal(value: Types.Decimal128): Decimal {
  return new Quantity(value.toString());
}

function remainingLayerValue(layer: CostLayerDoc): number {
  // Local pre-migration layers did not persist their rounded remaining cents.
  return layer.remainingValue ?? cents(asDecimal(layer.remainingQty).times(layer.unitCost));
}

function asMovementResult(movements: StockMovementDoc[], replayed: boolean): MovementResult {
  return {
    movementIds: movements.map((movement) => String(movement._id)),
    movements: movements.map((movement) => ({
      id: String(movement._id),
      movementNo: movement.movementNo,
      direction: movement.direction,
      quantity: movement.quantity.toString(),
      totalCost: movement.totalCost,
    })),
    replayed,
  };
}

async function existingRequest(
  key: string,
  hash: string,
  session?: ClientSession,
): Promise<MovementResult | undefined> {
  const request = await PostingRequest.findById(key).session(session ?? null);
  if (!request) return undefined;
  if (request.requestHash !== hash) {
    throw AppError.conflict('This idempotency key was already used for a different stock posting');
  }
  const movements = await StockMovement.find({ _id: { $in: request.movementIds } })
    .sort({ postedAt: 1, _id: 1 })
    .session(session ?? null);
  return asMovementResult(movements, true);
}

async function idempotentTransaction(
  key: string,
  hash: string,
  operation: (session: ClientSession) => Promise<StockMovementDoc[]>,
  onPosted?: PostingHook,
): Promise<MovementResult> {
  validateIdempotencyKey(key);
  const replay = await existingRequest(key, hash);
  if (replay) return replay;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();
    let result: MovementResult | undefined;
    try {
      await session.withTransaction(async () => {
        const prior = await existingRequest(key, hash, session);
        if (prior) {
          result = prior;
          return;
        }
        const movements = await operation(session);
        await onPosted?.(movements, session);
        await PostingRequest.create(
          [
            {
              _id: key,
              requestHash: hash,
              movementIds: movements.map((movement) => movement._id),
              completedAt: new Date(),
            },
          ],
          { session },
        );
        result = asMovementResult(movements, false);
      });
      if (!result) throw new Error('Stock transaction committed without a result');
      return result;
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) {
        const concurrentReplay = await existingRequest(key, hash);
        if (concurrentReplay) return concurrentReplay;
      }
      if (attempt < 2 && isRetryableConflict(err)) continue;
      throw err;
    } finally {
      await session.endSession();
    }
  }
  throw AppError.conflict(
    'Stock posting could not acquire the inventory balance; retry the request',
  );
}

function isRetryableConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; hasErrorLabel?: (label: string) => boolean };
  return e.code === 11000 || e.hasErrorLabel?.('TransientTransactionError') === true;
}

async function lockBalance(
  itemId: Types.ObjectId,
  locationId: Types.ObjectId,
  session: ClientSession,
) {
  const balance = await StockBalance.findOneAndUpdate(
    { itemId, locationId },
    {
      $setOnInsert: {
        onHand: decimal128(new Quantity(0)),
        reserved: decimal128(new Quantity(0)),
        value: 0,
      },
      $inc: { version: 1 },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
  );
  if (!balance) throw new Error('Stock balance could not be locked');
  return balance;
}

async function validateContext(
  itemId: Types.ObjectId,
  locationId: Types.ObjectId,
  session: ClientSession,
) {
  const item = await Item.findById(itemId).session(session);
  if (!item || !item.isActive) throw AppError.notFound('Active item not found');
  if (item.type === 'SERVICE')
    throw AppError.badRequest('Service items do not have stock movements');
  const location = await Location.findById(locationId).session(session);
  if (!location || !location.isActive) throw AppError.notFound('Active stock location not found');
  return item;
}

function serialList(
  itemTracksSerial: boolean,
  quantity: Decimal,
  serials: string[] | undefined,
): string[] {
  const normalized = (serials ?? []).map((serial) => serial.trim().toUpperCase());
  if (normalized.some((serial) => !serial) || new Set(normalized).size !== normalized.length) {
    throw AppError.badRequest('Serial numbers must be non-empty and unique');
  }
  if (itemTracksSerial) {
    if (
      !quantity.isInteger() ||
      quantity.greaterThan(Number.MAX_SAFE_INTEGER) ||
      normalized.length !== quantity.toNumber()
    ) {
      throw AppError.badRequest('Serial-tracked stock requires one serial number per whole unit');
    }
  } else if (normalized.length > 0) {
    throw AppError.badRequest('Serial numbers can only be posted for a serial-tracked item');
  }
  return normalized;
}

async function createMovement(
  values: Omit<StockMovementDoc, '_id' | 'movementNo'>,
  session: ClientSession,
): Promise<StockMovementDoc> {
  const movementNo = await nextDocumentNumber('STK', { date: values.postedAt, session });
  const [movement] = await StockMovement.create([{ ...values, movementNo }], { session });
  if (!movement) throw new Error('Stock movement was not created');
  return movement.toObject() as StockMovementDoc;
}

async function createInbound(
  input: PostInput,
  session: ClientSession,
  options: {
    createdFromLayerId?: Types.ObjectId;
    reversalOf?: Types.ObjectId;
    receivedAt?: Date;
    recordedTotalCost?: number;
  } = {},
): Promise<StockMovementDoc> {
  if (!IN_TYPES.has(input.movementType))
    throw AppError.badRequest(`${input.movementType} cannot add stock`);
  if (!Number.isSafeInteger(input.unitCost) || (input.unitCost as number) < 0) {
    throw AppError.badRequest(
      'Inbound unit cost must be a non-negative integer number of KES cents',
    );
  }
  validateSource(input.sourceDoc);
  const itemId = objectId(input.itemId, 'itemId');
  const locationId = objectId(input.locationId, 'locationId');
  const postedBy = objectId(input.postedBy, 'postedBy');
  const quantity = parseQuantity(input.quantity);
  const receivedAt = options.receivedAt ?? input.receivedAt ?? new Date();
  if (!Number.isFinite(receivedAt.getTime()))
    throw AppError.badRequest('receivedAt must be a valid date');
  const item = await validateContext(itemId, locationId, session);
  const serialNumbers = serialList(item.trackSerial, quantity, input.serialNumbers);
  const balance = await lockBalance(itemId, locationId, session);
  const postedAt = new Date();
  const totalCost = options.recordedTotalCost ?? cents(quantity.times(input.unitCost as number));
  if (!Number.isSafeInteger(totalCost) || totalCost < 0) {
    throw AppError.badRequest('Recorded inbound cost must be non-negative whole cents');
  }
  const layer = await CostLayer.create(
    [
      {
        itemId,
        locationId,
        sourceDoc: {
          type: input.sourceDoc.type,
          id: input.sourceDoc.id,
          number: input.sourceDoc.number,
        },
        receivedAt,
        originalQty: decimal128(quantity),
        remainingQty: decimal128(quantity),
        originalValue: totalCost,
        remainingValue: totalCost,
        unitCost: input.unitCost as number,
        costHistory: [],
        ...(options.createdFromLayerId ? { createdFromLayerId: options.createdFromLayerId } : {}),
      },
    ],
    { session },
  );
  const createdLayer = layer[0];
  if (!createdLayer) throw new Error('FIFO layer was not created');
  const movement = await createMovement(
    {
      itemId,
      locationId,
      direction: 'IN',
      quantity: decimal128(quantity),
      movementType: input.movementType,
      unitCost: input.unitCost as number,
      totalCost,
      layerCreated: createdLayer._id,
      sourceDoc: input.sourceDoc,
      serialNumbers,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(options.reversalOf ? { reversalOf: options.reversalOf } : {}),
      idempotencyKey: input.idempotencyKey,
      postedAt,
      postedBy,
    },
    session,
  );
  if (serialNumbers.length) {
    const existingSerials = await SerialNumber.find({ serialNo: { $in: serialNumbers } }).session(
      session,
    );
    if (existingSerials.length) {
      if (
        existingSerials.length !== serialNumbers.length ||
        existingSerials.some(
          (serial) => !serial.itemId.equals(itemId) || serial.status !== 'ISSUED',
        )
      ) {
        throw AppError.conflict('One or more serial numbers already exist or are not issued');
      }
      const returned = await SerialNumber.updateMany(
        { serialNo: { $in: serialNumbers }, itemId, status: 'ISSUED' },
        { $set: { locationId, status: 'IN_STOCK', lastMovementId: movement._id } },
        { session },
      );
      if (returned.modifiedCount !== serialNumbers.length)
        throw AppError.conflict('Serial stock changed during receipt');
    } else {
      await SerialNumber.create(
        serialNumbers.map((serialNo) => ({
          serialNo,
          itemId,
          locationId,
          status: 'IN_STOCK',
          lastMovementId: movement._id,
        })),
        { session },
      );
    }
  }
  balance.onHand = decimal128(asDecimal(balance.onHand).plus(quantity));
  balance.value = addCents(balance.value, totalCost);
  balance.lastMovementAt = postedAt;
  await balance.save({ session });
  await writeAuditLog({
    actorId: postedBy,
    action: options.reversalOf ? 'stock.reverse' : 'stock.post.in',
    entityType: 'stock_movement',
    entityId: movement._id,
    metadata: {
      movementNo: movement.movementNo,
      sourceDoc: input.sourceDoc,
      reason: input.reason,
      reversalOf: options.reversalOf,
    },
    session,
  });
  return movement;
}

async function consumeFifo(input: PostInput, session: ClientSession): Promise<StockMovementDoc> {
  if (!OUT_TYPES.has(input.movementType))
    throw AppError.badRequest(`${input.movementType} cannot remove stock`);
  validateSource(input.sourceDoc);
  const itemId = objectId(input.itemId, 'itemId');
  const locationId = objectId(input.locationId, 'locationId');
  const postedBy = objectId(input.postedBy, 'postedBy');
  const quantity = parseQuantity(input.quantity);
  const item = await validateContext(itemId, locationId, session);
  const serialNumbers = serialList(item.trackSerial, quantity, input.serialNumbers);
  const balance = await lockBalance(itemId, locationId, session);
  const onHand = asDecimal(balance.onHand);
  if (onHand.lessThan(quantity)) {
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      'The requested quantity exceeds available stock',
      {
        itemId: String(itemId),
        locationId: String(locationId),
        available: onHand.toString(),
        requested: quantity.toString(),
      },
    );
  }
  if (serialNumbers.length) {
    const available = await SerialNumber.countDocuments({
      serialNo: { $in: serialNumbers },
      itemId,
      locationId,
      status: 'IN_STOCK',
    }).session(session);
    if (available !== serialNumbers.length)
      throw AppError.conflict('One or more serial numbers are not in stock at this location');
  }

  const layers = await CostLayer.find({
    itemId,
    locationId,
  })
    .sort({ receivedAt: 1, _id: 1 })
    .session(session);
  let remaining = quantity;
  let totalCost = 0;
  const consumed: LayerSlice[] = [];
  for (const layer of layers) {
    if (remaining.isZero()) break;
    const layerRemaining = asDecimal(layer.remainingQty);
    const take = Quantity.min(layerRemaining, remaining);
    if (!take.greaterThan(0)) continue;
    const nextRemaining = layerRemaining.minus(take);
    // The recorded remaining value is authoritative. A transferred/reversed slice can
    // have a different rounded cost from quantity * unitCost by one cent.
    const beforeValue = remainingLayerValue(layer);
    const nextValue = nextRemaining.isZero()
      ? 0
      : Math.min(beforeValue, cents(nextRemaining.times(layer.unitCost)));
    const sliceCost = beforeValue - nextValue;
    const write = await CostLayer.updateOne(
      { _id: layer._id, remainingQty: layer.remainingQty },
      { $set: { remainingQty: decimal128(nextRemaining), remainingValue: nextValue } },
      { session },
    );
    if (write.modifiedCount !== 1)
      throw AppError.conflict('FIFO layer changed while the posting was in progress');
    consumed.push({
      layerId: layer._id,
      quantity: decimal128(take),
      unitCost: layer.unitCost,
      totalCost: sliceCost,
    });
    totalCost = addCents(totalCost, sliceCost);
    remaining = remaining.minus(take);
  }
  if (remaining.greaterThan(0)) {
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      'Stock layers do not contain the requested quantity',
      {
        available: quantity.minus(remaining).toString(),
        requested: quantity.toString(),
      },
    );
  }
  const postedAt = new Date();
  const unitCost = new Quantity(totalCost).dividedBy(quantity).toDecimalPlaces(0).toNumber();
  const movement = await createMovement(
    {
      itemId,
      locationId,
      direction: 'OUT',
      quantity: decimal128(quantity),
      movementType: input.movementType,
      unitCost,
      totalCost,
      layersConsumed: consumed,
      sourceDoc: input.sourceDoc,
      serialNumbers,
      ...(input.reason ? { reason: input.reason } : {}),
      idempotencyKey: input.idempotencyKey,
      postedAt,
      postedBy,
    },
    session,
  );
  if (serialNumbers.length) {
    const changed = await SerialNumber.updateMany(
      { serialNo: { $in: serialNumbers }, itemId, locationId, status: 'IN_STOCK' },
      { $set: { status: 'ISSUED', lastMovementId: movement._id } },
      { session },
    );
    if (changed.modifiedCount !== serialNumbers.length)
      throw AppError.conflict('Serial stock changed while the posting was in progress');
  }
  balance.onHand = decimal128(onHand.minus(quantity));
  balance.value = addCents(balance.value, -totalCost);
  balance.lastMovementAt = postedAt;
  await balance.save({ session });
  await writeAuditLog({
    actorId: postedBy,
    action: 'stock.post.out',
    entityType: 'stock_movement',
    entityId: movement._id,
    metadata: {
      movementNo: movement.movementNo,
      sourceDoc: input.sourceDoc,
      reason: input.reason,
      layersConsumed: consumed,
    },
    session,
  });
  return movement;
}

export async function postIn(input: PostInput, onPosted?: PostingHook): Promise<MovementResult> {
  const normalized = { ...input, quantity: parseQuantity(input.quantity).toString() };
  return idempotentTransaction(
    input.idempotencyKey,
    fingerprint({ direction: 'IN', ...normalized }),
    async (session) => [await createInbound(input, session)],
    onPosted,
  );
}

export async function postOut(input: PostInput, onPosted?: PostingHook): Promise<MovementResult> {
  const normalized = { ...input, quantity: parseQuantity(input.quantity).toString() };
  return idempotentTransaction(
    input.idempotencyKey,
    fingerprint({ direction: 'OUT', ...normalized }),
    async (session) => [await consumeFifo(input, session)],
    onPosted,
  );
}

export async function transfer(input: TransferInput): Promise<MovementResult> {
  if (String(input.fromLocationId) === String(input.toLocationId)) {
    throw AppError.badRequest('Source and destination locations must be different');
  }
  const normalized = { ...input, quantity: parseQuantity(input.quantity).toString() };
  return idempotentTransaction(
    input.idempotencyKey,
    fingerprint({ direction: 'TRANSFER', ...normalized }),
    async (session) => {
      const outbound = await consumeFifo(
        {
          itemId: input.itemId,
          locationId: input.fromLocationId,
          quantity: input.quantity,
          movementType: 'TRANSFER_OUT',
          sourceDoc: input.sourceDoc,
          postedBy: input.postedBy,
          idempotencyKey: input.idempotencyKey,
          serialNumbers: input.serialNumbers,
        },
        session,
      );
      const inbound: StockMovementDoc[] = [];
      let serialOffset = 0;
      for (let index = 0; index < (outbound.layersConsumed ?? []).length; index += 1) {
        const slice = (outbound.layersConsumed ?? [])[index];
        if (!slice) continue;
        const origin = await CostLayer.findById(slice.layerId).session(session);
        if (!origin)
          throw new Error('Consumed FIFO layer disappeared inside the stock transaction');
        const sliceQuantity = new Quantity(slice.quantity.toString());
        const serialCount = sliceQuantity.isInteger() ? sliceQuantity.toNumber() : 0;
        const sliceSerials = (input.serialNumbers ?? []).slice(
          serialOffset,
          serialOffset + serialCount,
        );
        serialOffset += serialCount;
        inbound.push(
          await createInbound(
            {
              itemId: input.itemId,
              locationId: input.toLocationId,
              quantity: slice.quantity.toString(),
              unitCost: slice.unitCost,
              movementType: 'TRANSFER_IN',
              sourceDoc: input.sourceDoc,
              postedBy: input.postedBy,
              idempotencyKey: input.idempotencyKey,
              serialNumbers: sliceSerials,
            },
            session,
            {
              createdFromLayerId: slice.layerId,
              receivedAt: origin.receivedAt,
              recordedTotalCost: slice.totalCost,
            },
          ),
        );
      }
      return [outbound, ...inbound];
    },
  );
}

function inverseMovementType(type: StockMovementType, direction: 'IN' | 'OUT'): StockMovementType {
  const map: Record<StockMovementType, { IN: StockMovementType; OUT: StockMovementType }> = {
    OPENING: { IN: 'OPENING', OUT: 'ADJUSTMENT_OUT' },
    GRN: { IN: 'GRN', OUT: 'PURCHASE_RETURN' },
    PRODUCTION_ISSUE: { IN: 'PRODUCTION_RECEIPT', OUT: 'PRODUCTION_ISSUE' },
    PRODUCTION_RECEIPT: { IN: 'PRODUCTION_RECEIPT', OUT: 'PRODUCTION_ISSUE' },
    SALE: { IN: 'SALE_RETURN', OUT: 'SALE' },
    SALE_RETURN: { IN: 'SALE_RETURN', OUT: 'SALE' },
    PURCHASE_RETURN: { IN: 'GRN', OUT: 'PURCHASE_RETURN' },
    ADJUSTMENT_IN: { IN: 'ADJUSTMENT_IN', OUT: 'ADJUSTMENT_OUT' },
    ADJUSTMENT_OUT: { IN: 'ADJUSTMENT_IN', OUT: 'ADJUSTMENT_OUT' },
    TRANSFER_IN: { IN: 'TRANSFER_IN', OUT: 'TRANSFER_OUT' },
    TRANSFER_OUT: { IN: 'TRANSFER_IN', OUT: 'TRANSFER_OUT' },
    COUNT_VARIANCE: { IN: 'COUNT_VARIANCE', OUT: 'COUNT_VARIANCE' },
  };
  return map[type][direction];
}

async function reverseOne(
  original: StockMovementDoc,
  postedBy: Types.ObjectId,
  idempotencyKey: string,
  session: ClientSession,
  approvalDoc?: SourceDocument,
  reason?: string,
): Promise<StockMovementDoc[]> {
  const reversalSource: SourceDocument = approvalDoc ?? {
    type: 'REVERSAL',
    id: String(original._id),
    number: original.movementNo,
  };
  if (original.direction === 'OUT') {
    const results: StockMovementDoc[] = [];
    let serialOffset = 0;
    for (const slice of original.layersConsumed ?? []) {
      const origin = await CostLayer.findById(slice.layerId).session(session);
      if (!origin) throw AppError.conflict('The original FIFO layer no longer exists');
      const quantity = asDecimal(slice.quantity);
      const serialCount = quantity.isInteger() ? quantity.toNumber() : 0;
      const serialNumbers = original.serialNumbers.slice(serialOffset, serialOffset + serialCount);
      serialOffset += serialCount;
      results.push(
        await createInbound(
          {
            itemId: original.itemId,
            locationId: original.locationId,
            quantity: quantity.toString(),
            unitCost: slice.unitCost,
            movementType: inverseMovementType(original.movementType, 'IN'),
            sourceDoc: reversalSource,
            postedBy,
            idempotencyKey,
            serialNumbers,
            ...(reason ? { reason } : {}),
          },
          session,
          {
            createdFromLayerId: slice.layerId,
            receivedAt: origin.receivedAt,
            reversalOf: original._id,
            recordedTotalCost: slice.totalCost,
          },
        ),
      );
    }
    return results;
  }

  const layerId = original.layerCreated;
  if (!layerId) throw AppError.conflict('The original inbound movement has no linked FIFO layer');
  const layer = await CostLayer.findById(layerId).session(session);
  if (!layer || !asDecimal(layer.remainingQty).equals(asDecimal(original.quantity))) {
    throw AppError.conflict(
      'This receipt cannot be reversed because some of its stock has already been consumed',
    );
  }
  const balance = await lockBalance(original.itemId, original.locationId, session);
  const quantity = asDecimal(original.quantity);
  const beforeValue = remainingLayerValue(layer);
  const updated = await CostLayer.updateOne(
    { _id: layer._id, remainingQty: layer.remainingQty },
    { $set: { remainingQty: decimal128(new Quantity(0)), remainingValue: 0 } },
    { session },
  );
  if (updated.modifiedCount !== 1) throw AppError.conflict('FIFO layer changed during reversal');
  const postedAt = new Date();
  const movement = await createMovement(
    {
      itemId: original.itemId,
      locationId: original.locationId,
      direction: 'OUT',
      quantity: original.quantity,
      movementType: inverseMovementType(original.movementType, 'OUT'),
      unitCost: layer.unitCost,
      totalCost: beforeValue,
      layersConsumed: [
        {
          layerId: layer._id,
          quantity: original.quantity,
          unitCost: layer.unitCost,
          totalCost: beforeValue,
        },
      ],
      sourceDoc: reversalSource,
      serialNumbers: original.serialNumbers,
      ...(reason ? { reason } : {}),
      reversalOf: original._id,
      idempotencyKey,
      postedAt,
      postedBy,
    },
    session,
  );
  if (original.serialNumbers.length) {
    const changed = await SerialNumber.updateMany(
      {
        serialNo: { $in: original.serialNumbers },
        itemId: original.itemId,
        locationId: original.locationId,
        status: 'IN_STOCK',
      },
      { $set: { status: 'ISSUED', lastMovementId: movement._id } },
      { session },
    );
    if (changed.modifiedCount !== original.serialNumbers.length)
      throw AppError.conflict('Serial stock changed during reversal');
  }
  balance.onHand = decimal128(asDecimal(balance.onHand).minus(quantity));
  balance.value = addCents(balance.value, -beforeValue);
  balance.lastMovementAt = postedAt;
  await balance.save({ session });
  await writeAuditLog({
    actorId: postedBy,
    action: 'stock.reverse',
    entityType: 'stock_movement',
    entityId: movement._id,
    metadata: { reversalOf: original._id, movementNo: original.movementNo, reason },
    session,
  });
  return [movement];
}

export async function reverse(
  input: {
    movementId: string | Types.ObjectId;
    postedBy: string | Types.ObjectId;
    idempotencyKey: string;
    approvalDoc?: SourceDocument;
    reason?: string;
  },
  onPosted?: PostingHook,
): Promise<MovementResult> {
  const movementId = objectId(input.movementId, 'movementId');
  const postedBy = objectId(input.postedBy, 'postedBy');
  const hash = fingerprint({
    action: 'REVERSE',
    movementId: String(movementId),
    postedBy: String(postedBy),
    approvalDoc: input.approvalDoc,
    reason: input.reason,
  });
  return idempotentTransaction(
    input.idempotencyKey,
    hash,
    async (session) => {
      const original = await StockMovement.findById(movementId).session(session);
      if (!original) throw AppError.notFound('Stock movement not found');
      const alreadyReversed = await StockMovement.exists({ reversalOf: original._id }).session(
        session,
      );
      if (alreadyReversed) throw AppError.conflict('This stock movement has already been reversed');
      if (original.movementType === 'TRANSFER_IN' || original.movementType === 'TRANSFER_OUT') {
        const request = await PostingRequest.findOne({ movementIds: original._id }).session(
          session,
        );
        if (!request)
          throw AppError.conflict(
            'The transfer posting record is missing; it cannot be reversed safely',
          );
        const transferMovements = await StockMovement.find({ _id: { $in: request.movementIds } })
          .sort({ postedAt: -1, _id: -1 })
          .session(session);
        const results: StockMovementDoc[] = [];
        for (const transferMovement of transferMovements) {
          if (await StockMovement.exists({ reversalOf: transferMovement._id }).session(session)) {
            throw AppError.conflict('Part of this transfer has already been reversed');
          }
          results.push(
            ...(await reverseOne(
              transferMovement.toObject() as StockMovementDoc,
              postedBy,
              input.idempotencyKey,
              session,
              input.approvalDoc,
              input.reason,
            )),
          );
        }
        return results;
      }
      return reverseOne(
        original.toObject() as StockMovementDoc,
        postedBy,
        input.idempotencyKey,
        session,
        input.approvalDoc,
        input.reason,
      );
    },
    onPosted,
  );
}

export async function getStockBalance(itemId: string, locationId?: string) {
  const itemObjectId = objectId(itemId, 'itemId');
  const filter = locationId
    ? { itemId: itemObjectId, locationId: objectId(locationId, 'locationId') }
    : { itemId: itemObjectId };
  return StockBalance.find(filter)
    .populate('locationId', 'code name type')
    .sort({ locationId: 1 })
    .lean();
}

export async function listStockBalances(options: { itemId?: string; locationId?: string } = {}) {
  const filter: Record<string, Types.ObjectId> = {};
  if (options.itemId) filter.itemId = objectId(options.itemId, 'itemId');
  if (options.locationId) filter.locationId = objectId(options.locationId, 'locationId');
  return StockBalance.find(filter)
    .populate('itemId', 'sku name type baseUnit')
    .populate('locationId', 'code name type')
    .sort({ itemId: 1, locationId: 1 })
    .lean();
}

export async function getFifoLayers(itemId: string, locationId: string) {
  return CostLayer.find({
    itemId: objectId(itemId, 'itemId'),
    locationId: objectId(locationId, 'locationId'),
  })
    .sort({ receivedAt: 1, _id: 1 })
    .lean();
}

export async function getMovementHistory(
  itemId: string,
  options: { locationId?: string; before?: string; limit?: number } = {},
) {
  const filter: Record<string, unknown> = { itemId: objectId(itemId, 'itemId') };
  if (options.locationId) filter.locationId = objectId(options.locationId, 'locationId');
  if (options.before) {
    if (!Types.ObjectId.isValid(options.before))
      throw AppError.badRequest('before must be a valid movement id');
    filter._id = { $lt: new Types.ObjectId(options.before) };
  }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  return StockMovement.find(filter).sort({ _id: -1 }).limit(limit).lean();
}

export async function reconcileBalances() {
  const balances = await StockBalance.find().lean();
  const layers = await CostLayer.find().lean();
  const movements = await StockMovement.find().lean();
  const balanceMap = new Map(
    balances.map((balance) => [`${balance.itemId}:${balance.locationId}`, balance]),
  );
  const layerMap = new Map<string, { quantity: Decimal; value: number }>();
  const movementMap = new Map<string, { quantity: Decimal; value: number }>();
  for (const layer of layers) {
    const key = `${layer.itemId}:${layer.locationId}`;
    const aggregate = layerMap.get(key) ?? { quantity: new Quantity(0), value: 0 };
    const quantity = asDecimal(layer.remainingQty);
    aggregate.quantity = aggregate.quantity.plus(quantity);
    aggregate.value = addCents(aggregate.value, remainingLayerValue(layer));
    layerMap.set(key, aggregate);
  }
  for (const movement of movements) {
    const key = `${movement.itemId}:${movement.locationId}`;
    const aggregate = movementMap.get(key) ?? { quantity: new Quantity(0), value: 0 };
    const quantity = asDecimal(movement.quantity);
    const sign = movement.direction === 'IN' ? 1 : -1;
    aggregate.quantity = aggregate.quantity.plus(quantity.times(sign));
    aggregate.value = addCents(aggregate.value, movement.totalCost * sign);
    movementMap.set(key, aggregate);
  }
  const differences: Array<{
    itemId: string;
    locationId: string;
    balanceQty: string;
    ledgerQty: string;
    layerQty: string;
    balanceValue: number;
    ledgerValue: number;
    layerValue: number;
  }> = [];
  const allKeys = new Set([...balanceMap.keys(), ...layerMap.keys(), ...movementMap.keys()]);
  for (const key of allKeys) {
    const balance = balanceMap.get(key);
    const [itemId = '', locationId = ''] = key.split(':');
    const layerAggregate = layerMap.get(key) ?? { quantity: new Quantity(0), value: 0 };
    const movementAggregate = movementMap.get(key) ?? { quantity: new Quantity(0), value: 0 };
    const balanceQty = balance ? asDecimal(balance.onHand) : new Quantity(0);
    const balanceValue = balance?.value ?? 0;
    if (
      !layerAggregate.quantity.equals(balanceQty) ||
      !movementAggregate.quantity.equals(balanceQty) ||
      layerAggregate.value !== balanceValue ||
      movementAggregate.value !== balanceValue ||
      !layerAggregate.quantity.equals(movementAggregate.quantity) ||
      layerAggregate.value !== movementAggregate.value
    ) {
      differences.push({
        itemId,
        locationId,
        balanceQty: balanceQty.toString(),
        ledgerQty: movementAggregate.quantity.toString(),
        layerQty: layerAggregate.quantity.toString(),
        balanceValue,
        ledgerValue: movementAggregate.value,
        layerValue: layerAggregate.value,
      });
    }
  }
  return { checked: allKeys.size, differences };
}

export async function postOpeningStock(
  input: Omit<PostInput, 'movementType'>,
  onPosted?: PostingHook,
): Promise<MovementResult> {
  return postIn({ ...input, movementType: 'OPENING' }, onPosted);
}

export async function postAdjustment(
  input: Omit<PostInput, 'movementType'> & { direction: 'IN' | 'OUT'; reason: string },
  onPosted?: PostingHook,
): Promise<MovementResult> {
  if (!input.reason.trim()) throw AppError.badRequest('Adjustment reason is required');
  const { direction, ...posting } = input;
  return direction === 'IN'
    ? postIn({ ...posting, movementType: 'ADJUSTMENT_IN' }, onPosted)
    : postOut({ ...posting, movementType: 'ADJUSTMENT_OUT' }, onPosted);
}

export async function assertStockInvariants() {
  const result = await reconcileBalances();
  if (result.differences.length)
    throw AppError.conflict('Stock balance reconciliation found differences', result);
  return result;
}

export type { CostLayerDoc };
