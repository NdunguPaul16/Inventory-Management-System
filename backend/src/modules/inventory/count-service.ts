import { Decimal } from 'decimal.js';
import mongoose, { Types, type ClientSession } from 'mongoose';
import type {
  z,
  freezeStockCountSchema,
  enterStockCountSchema,
  enterSerialStockCountSchema,
  stockCountQuerySchema,
} from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../audit/service.js';
import { nextDocumentNumber } from '../counters/service.js';
import { Item } from './items/model.js';
import { Location } from './locations/model.js';
import { SerialNumber, StockBalance } from './engine/models.js';
import {
  assertCountPostingBalance,
  lockUnchangedCountBalance,
  postIn,
  postOut,
  postSerialCountVariance,
} from './engine/service.js';
import { StockCount, type StockCountDoc } from './count-model.js';
import { stockDecimal128 } from './quantity.js';

type FreezeInput = z.infer<typeof freezeStockCountSchema>;
type EntryInput = z.infer<typeof enterStockCountSchema>;
type SerialEntryInput = z.infer<typeof enterSerialStockCountSchema>;
type CountQuery = z.infer<typeof stockCountQuerySchema>;
const Quantity = Decimal.clone({ precision: 60 });

function id(value: string, name: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw AppError.badRequest(`${name} must be a valid id`);
  return new Types.ObjectId(value);
}

function publicCount(count: StockCountDoc) {
  return {
    id: String(count._id),
    countNo: count.countNo,
    itemId: String(count.itemId),
    locationId: String(count.locationId),
    status: count.status,
    mode: count.mode ?? 'QUANTITY',
    bookQuantity: count.bookQuantity.toString(),
    bookSerialNumbers: count.bookSerialNumbers ?? null,
    bookValue: count.bookValue,
    bookVersion: count.bookVersion,
    frozenAt: count.frozenAt.toISOString(),
    frozenBy: String(count.frozenBy),
    countedQuantity: count.countedQuantity?.toString() ?? null,
    countedSerialNumbers: count.countedSerialNumbers ?? null,
    varianceQuantity: count.varianceQuantity?.toString() ?? null,
    inboundUnitCost: count.inboundUnitCost ?? null,
    reason: count.reason ?? null,
    countedAt: count.countedAt?.toISOString() ?? null,
    countedBy: count.countedBy ? String(count.countedBy) : null,
    approvedAt: count.approvedAt?.toISOString() ?? null,
    approvedBy: count.approvedBy ? String(count.approvedBy) : null,
    rejectedAt: count.rejectedAt?.toISOString() ?? null,
    rejectedBy: count.rejectedBy ? String(count.rejectedBy) : null,
    rejectionReason: count.rejectionReason ?? null,
    postedAt: count.postedAt?.toISOString() ?? null,
    postedBy: count.postedBy ? String(count.postedBy) : null,
    movementIds: count.movementIds.map(String),
    createdAt: count.createdAt.toISOString(),
    updatedAt: count.updatedAt.toISOString(),
  };
}

async function inTransaction<T>(operation: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(() => operation(session));
    if (result === undefined) throw new Error('Stock count transaction produced no result');
    return result;
  } finally {
    await session.endSession();
  }
}

async function findCount(countId: string, session: ClientSession) {
  const count = await StockCount.findById(id(countId, 'countId')).session(session);
  if (!count) throw AppError.notFound('Stock count not found');
  return count;
}

async function assertBookUnchanged(count: StockCountDoc, session?: ClientSession) {
  const balance = await StockBalance.findOne({ itemId: count.itemId, locationId: count.locationId })
    .session(session ?? null)
    .lean();
  if (
    (balance?.version ?? 0) !== count.bookVersion ||
    !new Quantity(balance?.onHand.toString() ?? '0').equals(count.bookQuantity.toString())
  ) {
    throw AppError.conflict('Stock changed after the count was frozen; start a new count');
  }
  if (count.mode === 'SERIAL') {
    const serials = await SerialNumber.find({
      itemId: count.itemId,
      locationId: count.locationId,
      status: 'IN_STOCK',
    })
      .session(session ?? null)
      .select('serialNo')
      .lean();
    const actual = serials.map((serial) => serial.serialNo).sort();
    if (JSON.stringify(actual) !== JSON.stringify(count.bookSerialNumbers ?? [])) {
      throw AppError.conflict('Serial stock changed after the count was frozen; start a new count');
    }
  }
}

export async function freezeStockCount(input: FreezeInput, actorId: string) {
  const itemId = id(input.itemId, 'itemId');
  const locationId = id(input.locationId, 'locationId');
  const actor = id(actorId, 'actorId');
  try {
    return await inTransaction(async (session) => {
      const item = await Item.findById(itemId).session(session);
      if (!item || !item.isActive || item.type === 'SERVICE')
        throw AppError.notFound('Active stocked item not found');
      const location = await Location.findById(locationId).session(session);
      if (!location || !location.isActive)
        throw AppError.notFound('Active stock location not found');
      const balance = await StockBalance.findOne({ itemId, locationId }).session(session);
      const bookSerialNumbers = item.trackSerial
        ? (
            await SerialNumber.find({ itemId, locationId, status: 'IN_STOCK' })
              .session(session)
              .select('serialNo')
              .lean()
          )
            .map((serial) => serial.serialNo)
            .sort()
        : undefined;
      if (
        bookSerialNumbers &&
        !new Quantity(balance?.onHand.toString() ?? '0').equals(bookSerialNumbers.length)
      ) {
        throw AppError.conflict('Serial records do not match the stock balance');
      }
      const [count] = await StockCount.create(
        [
          {
            countNo: await nextDocumentNumber('COUNT', { session }),
            itemId,
            locationId,
            activeKey: `${itemId}:${locationId}`,
            status: 'FROZEN',
            mode: item.trackSerial ? 'SERIAL' : 'QUANTITY',
            bookQuantity: balance?.onHand ?? Types.Decimal128.fromString('0'),
            ...(bookSerialNumbers ? { bookSerialNumbers } : {}),
            bookValue: balance?.value ?? 0,
            bookVersion: balance?.version ?? 0,
            frozenAt: new Date(),
            frozenBy: actor,
          },
        ],
        { session },
      );
      if (!count) throw new Error('Stock count was not created');
      await writeAuditLog({
        actorId: actor,
        action: 'stock.count.freeze',
        entityType: 'stock_count',
        entityId: count._id,
        after: publicCount(count),
        session,
      });
      return publicCount(count);
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000)
      throw AppError.conflict('An active count already exists for this item and location');
    throw error;
  }
}

export async function enterStockCount(countId: string, input: EntryInput, actorId: string) {
  const actor = id(actorId, 'actorId');
  return inTransaction(async (session) => {
    const count = await findCount(countId, session);
    if (count.mode === 'SERIAL') throw AppError.badRequest('Use serial entry for this count');
    if (count.status !== 'FROZEN') throw AppError.conflict('Count entry is already submitted');
    const counted = new Quantity(input.countedQuantity);
    if (!counted.isFinite() || counted.isNegative())
      throw AppError.badRequest('Counted quantity must be non-negative');
    const variance = counted.minus(count.bookQuantity.toString());
    if (variance.greaterThan(0) && input.inboundUnitCost === undefined)
      throw AppError.badRequest('Inbound unit cost is required for a positive count variance');
    if (!variance.greaterThan(0) && input.inboundUnitCost !== undefined)
      throw AppError.badRequest('Inbound unit cost applies only to a positive variance');
    await assertBookUnchanged(count, session);
    const before = publicCount(count);
    count.countedQuantity = stockDecimal128(counted);
    count.varianceQuantity = stockDecimal128(variance);
    if (input.inboundUnitCost !== undefined) count.inboundUnitCost = input.inboundUnitCost;
    count.reason = input.reason;
    count.countedBy = actor;
    count.countedAt = new Date();
    count.status = 'PENDING_APPROVAL';
    await count.save({ session });
    const after = publicCount(count);
    await writeAuditLog({
      actorId: actor,
      action: 'stock.count.enter',
      entityType: 'stock_count',
      entityId: count._id,
      before,
      after,
      session,
    });
    return after;
  });
}

export async function enterSerialStockCount(
  countId: string,
  input: SerialEntryInput,
  actorId: string,
) {
  const actor = id(actorId, 'actorId');
  const serialNumbers = input.serialNumbers.map((serial) => serial.trim().toUpperCase()).sort();
  if (
    serialNumbers.some((serial) => !serial) ||
    new Set(serialNumbers).size !== serialNumbers.length
  ) {
    throw AppError.badRequest('Serial numbers must be non-empty and unique');
  }
  return inTransaction(async (session) => {
    const count = await findCount(countId, session);
    if (count.mode !== 'SERIAL')
      throw AppError.badRequest('Count is not for a serial-tracked item');
    if (count.status !== 'FROZEN') throw AppError.conflict('Count entry is already submitted');
    await assertBookUnchanged(count, session);
    const book = new Set(count.bookSerialNumbers ?? []);
    const added = serialNumbers.filter((serial) => !book.has(serial));
    if (added.length > 0 && input.inboundUnitCost === undefined) {
      throw AppError.badRequest('Inbound unit cost is required for found serials');
    }
    if (added.length === 0 && input.inboundUnitCost !== undefined) {
      throw AppError.badRequest('Inbound unit cost applies only to found serials');
    }
    const before = publicCount(count);
    count.countedSerialNumbers = serialNumbers;
    count.countedQuantity = Types.Decimal128.fromString(String(serialNumbers.length));
    count.varianceQuantity = Types.Decimal128.fromString(String(serialNumbers.length - book.size));
    if (input.inboundUnitCost !== undefined) count.inboundUnitCost = input.inboundUnitCost;
    count.reason = input.reason;
    count.countedBy = actor;
    count.countedAt = new Date();
    count.status = 'PENDING_APPROVAL';
    await count.save({ session });
    const after = publicCount(count);
    await writeAuditLog({
      actorId: actor,
      action: 'stock.count.enter',
      entityType: 'stock_count',
      entityId: count._id,
      before,
      after,
      session,
    });
    return after;
  });
}

export async function approveStockCount(countId: string, actorId: string) {
  const actor = id(actorId, 'actorId');
  return inTransaction(async (session) => {
    const count = await findCount(countId, session);
    if (count.status !== 'PENDING_APPROVAL')
      throw AppError.conflict('Count is not pending approval');
    if (count.countedBy?.equals(actor) || count.frozenBy.equals(actor))
      throw AppError.forbidden('A different authorised user must approve the count');
    await assertBookUnchanged(count, session);
    const before = publicCount(count);
    count.status = 'APPROVED';
    count.approvedBy = actor;
    count.approvedAt = new Date();
    await count.save({ session });
    const after = publicCount(count);
    await writeAuditLog({
      actorId: actor,
      action: 'stock.count.approve',
      entityType: 'stock_count',
      entityId: count._id,
      before,
      after,
      session,
    });
    return after;
  });
}

export async function rejectStockCount(countId: string, actorId: string, reason: string) {
  const actor = id(actorId, 'actorId');
  return inTransaction(async (session) => {
    const count = await findCount(countId, session);
    if (!['FROZEN', 'PENDING_APPROVAL', 'APPROVED'].includes(count.status))
      throw AppError.conflict('Count cannot be rejected in its current state');
    const before = publicCount(count);
    count.status = 'REJECTED';
    count.rejectedBy = actor;
    count.rejectedAt = new Date();
    count.rejectionReason = reason;
    count.activeKey = undefined;
    await count.save({ session });
    const after = publicCount(count);
    await writeAuditLog({
      actorId: actor,
      action: 'stock.count.reject',
      entityType: 'stock_count',
      entityId: count._id,
      before,
      after,
      session,
    });
    return after;
  });
}

export async function postStockCount(countId: string, actorId: string) {
  const actor = id(actorId, 'actorId');
  const count = await StockCount.findById(id(countId, 'countId'));
  if (!count) throw AppError.notFound('Stock count not found');
  if (count.status === 'POSTED') return publicCount(count);
  if (count.status !== 'APPROVED') throw AppError.conflict('Count must be approved before posting');
  if (!count.approvedBy?.equals(actor))
    throw AppError.forbidden('The approver must post this count');
  if (!count.countedQuantity || !count.varianceQuantity)
    throw AppError.conflict('Count entry is incomplete');
  await assertBookUnchanged(count);

  const finish = async (movementIds: Types.ObjectId[], session: ClientSession) => {
    const current = await findCount(countId, session);
    if (current.status !== 'APPROVED' || !current.approvedBy?.equals(actor))
      throw AppError.conflict('Count changed while posting');
    const before = publicCount(current);
    current.status = 'POSTED';
    current.postedBy = actor;
    current.postedAt = new Date();
    current.movementIds = movementIds;
    current.activeKey = undefined;
    await current.save({ session });
    await writeAuditLog({
      actorId: actor,
      action: 'stock.count.post',
      entityType: 'stock_count',
      entityId: current._id,
      before,
      after: publicCount(current),
      session,
    });
  };

  const variance = new Quantity(count.varianceQuantity.toString());
  const bookSerials = new Set(count.bookSerialNumbers ?? []);
  const countedSerials = new Set(count.countedSerialNumbers ?? []);
  const missingSerials = (count.bookSerialNumbers ?? []).filter(
    (serial) => !countedSerials.has(serial),
  );
  const addedSerials = (count.countedSerialNumbers ?? []).filter(
    (serial) => !bookSerials.has(serial),
  );
  if (count.mode === 'SERIAL' && !count.countedSerialNumbers) {
    throw AppError.conflict('Serial count entry is incomplete');
  }
  if (variance.isZero() && missingSerials.length === 0 && addedSerials.length === 0) {
    return inTransaction(async (session) => {
      await lockUnchangedCountBalance(
        String(count.itemId),
        String(count.locationId),
        count.bookVersion,
        count.bookQuantity.toString(),
        session,
      );
      await finish([], session);
      return getStockCount(countId, session);
    });
  }

  const posting = {
    itemId: count.itemId,
    locationId: count.locationId,
    quantity: variance.abs().toString(),
    movementType: 'COUNT_VARIANCE' as const,
    sourceDoc: { type: 'STOCK_COUNT', id: countId, number: count.countNo },
    postedBy: actor,
    idempotencyKey: `stock-count:${countId}`,
    reason: count.reason,
  };
  const onPosted = async (movements: { _id: Types.ObjectId }[], session: ClientSession) => {
    await assertCountPostingBalance(
      String(count.itemId),
      String(count.locationId),
      count.bookVersion,
      count.countedQuantity!.toString(),
      session,
      movements.length,
    );
    await finish(
      movements.map((movement) => movement._id),
      session,
    );
  };
  if (count.mode === 'SERIAL') {
    await postSerialCountVariance(
      {
        itemId: count.itemId,
        locationId: count.locationId,
        missingSerials,
        addedSerials,
        inboundUnitCost: count.inboundUnitCost,
        sourceDoc: posting.sourceDoc,
        postedBy: actor,
        idempotencyKey: posting.idempotencyKey,
        reason: count.reason ?? 'Approved serial count variance',
      },
      onPosted,
    );
    return getStockCount(countId);
  }
  if (variance.isPositive()) {
    await postIn({ ...posting, unitCost: count.inboundUnitCost }, onPosted);
  } else {
    await postOut(posting, onPosted);
  }
  return getStockCount(countId);
}

export async function getStockCount(countId: string, session?: ClientSession) {
  const count = await StockCount.findById(id(countId, 'countId')).session(session ?? null);
  if (!count) throw AppError.notFound('Stock count not found');
  return publicCount(count);
}

export async function listStockCounts(options: CountQuery) {
  const filter: Record<string, unknown> = {};
  if (options.status) filter.status = options.status;
  if (options.itemId) filter.itemId = id(options.itemId, 'itemId');
  if (options.locationId) filter.locationId = id(options.locationId, 'locationId');
  if (options.before) filter._id = { $lt: id(options.before, 'before') };
  const counts = await StockCount.find(filter).sort({ _id: -1 }).limit(options.limit);
  if (counts.length === 0) return [];
  const [items, locations] = await Promise.all([
    Item.find({ _id: { $in: counts.map((count) => count.itemId) } })
      .select('sku name')
      .lean(),
    Location.find({ _id: { $in: counts.map((count) => count.locationId) } })
      .select('code name')
      .lean(),
  ]);
  const itemsById = new Map(items.map((item) => [String(item._id), item]));
  const locationsById = new Map(locations.map((location) => [String(location._id), location]));
  return counts.map((count) => {
    const item = itemsById.get(String(count.itemId));
    const location = locationsById.get(String(count.locationId));
    return {
      ...publicCount(count),
      item: item ? { sku: item.sku, name: item.name } : null,
      location: location ? { code: location.code, name: location.name } : null,
    };
  });
}
