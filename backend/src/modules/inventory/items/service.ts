import mongoose, { Types } from 'mongoose';
import type { CreateItemInput, MasterDataQuery, UpdateItemInput } from '@ims/shared';
import { AppError } from '../../../lib/errors.js';
import { writeAuditLog } from '../../audit/service.js';
import { StockMovement } from '../engine/models.js';
import { Item, type ItemDoc } from './model.js';

function publicItem(item: ItemDoc & { _id: Types.ObjectId }) {
  return {
    id: String(item._id),
    sku: item.sku,
    name: item.name,
    type: item.type,
    baseUnit: item.baseUnit,
    description: item.description ?? '',
    unitConversions: (item.unitConversions ?? []).map((conversion) => ({
      unit: conversion.unit,
      baseQuantity: conversion.baseQuantity,
    })),
    reorderLevel: item.reorderLevel ?? null,
    reorderQty: item.reorderQty ?? null,
    leadTimeDays: item.leadTimeDays ?? null,
    trackSerial: item.trackSerial,
    trackBatch: item.trackBatch,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function safeRegex(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

export async function listItems(query: MasterDataQuery) {
  const search = query.q ? safeRegex(query.q) : undefined;
  const items = await Item.find({
    ...(query.before ? { _id: { $lt: new Types.ObjectId(query.before) } } : {}),
    ...(query.status !== 'all' ? { isActive: query.status === 'active' } : {}),
    ...(search ? { $or: [{ sku: search }, { name: search }] } : {}),
  })
    .sort({ _id: -1 })
    .limit(query.limit)
    .lean();
  return items.map(publicItem);
}

export async function getItem(itemId: string) {
  const item = await Item.findById(itemId).lean();
  if (!item) throw AppError.notFound('Item not found');
  return publicItem(item);
}

export async function createItem(input: CreateItemInput, actorId: string) {
  const session = await mongoose.startSession();
  try {
    const created = await session.withTransaction(async () => {
      const [item] = await Item.create([input], { session });
      if (!item) throw new Error('Item was not created');
      const result = publicItem(item);
      await writeAuditLog({
        actorId,
        action: 'item.create',
        entityType: 'item',
        entityId: item._id,
        after: result,
        session,
      });
      return result;
    });
    if (!created) throw new Error('Item transaction completed without a result');
    return created;
  } finally {
    await session.endSession();
  }
}

export async function updateItem(itemId: string, input: UpdateItemInput, actorId: string) {
  const session = await mongoose.startSession();
  try {
    const updated = await session.withTransaction(async () => {
      const item = await Item.findById(itemId).session(session);
      if (!item) throw AppError.notFound('Item not found');
      const before = publicItem(item);
      if (
        (input.unitConversions ?? before.unitConversions).some(
          (conversion) => conversion.unit === (input.baseUnit ?? item.baseUnit),
        )
      ) {
        throw AppError.badRequest('Conversion unit must differ from the base unit');
      }
      const identityChanged =
        (input.sku !== undefined && input.sku !== item.sku) ||
        (input.type !== undefined && input.type !== item.type) ||
        (input.baseUnit !== undefined && input.baseUnit !== item.baseUnit) ||
        (input.trackSerial !== undefined && input.trackSerial !== item.trackSerial) ||
        (input.trackBatch !== undefined && input.trackBatch !== item.trackBatch) ||
        (input.unitConversions !== undefined &&
          JSON.stringify(input.unitConversions) !== JSON.stringify(before.unitConversions));
      if (
        (identityChanged || input.isActive === false) &&
        (await StockMovement.exists({ itemId: item._id }).session(session))
      ) {
        throw AppError.conflict('Stocked item identity and status cannot be changed');
      }
      Object.assign(item, input);
      await item.save({ session });
      const after = publicItem(item);
      await writeAuditLog({
        actorId,
        action: 'item.update',
        entityType: 'item',
        entityId: item._id,
        before,
        after,
        session,
      });
      return after;
    });
    if (!updated) throw new Error('Item transaction completed without a result');
    return updated;
  } finally {
    await session.endSession();
  }
}
