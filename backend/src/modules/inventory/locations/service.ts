import mongoose, { Types } from 'mongoose';
import type { CreateLocationInput, MasterDataQuery, UpdateLocationInput } from '@ims/shared';
import { AppError } from '../../../lib/errors.js';
import { writeAuditLog } from '../../audit/service.js';
import { StockMovement } from '../engine/models.js';
import { Location, type LocationDoc } from './model.js';

function publicLocation(location: LocationDoc & { _id: Types.ObjectId }) {
  return {
    id: String(location._id),
    code: location.code,
    name: location.name,
    type: location.type,
    isActive: location.isActive,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function safeRegex(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

export async function listLocations(query: MasterDataQuery) {
  const search = query.q ? safeRegex(query.q) : undefined;
  const locations = await Location.find({
    ...(query.before ? { _id: { $lt: new Types.ObjectId(query.before) } } : {}),
    ...(query.status !== 'all' ? { isActive: query.status === 'active' } : {}),
    ...(search ? { $or: [{ code: search }, { name: search }] } : {}),
  })
    .sort({ _id: -1 })
    .limit(query.limit)
    .lean();
  return locations.map(publicLocation);
}

export async function getLocation(locationId: string) {
  const location = await Location.findById(locationId).lean();
  if (!location) throw AppError.notFound('Location not found');
  return publicLocation(location);
}

export async function createLocation(input: CreateLocationInput, actorId: string) {
  const session = await mongoose.startSession();
  try {
    const created = await session.withTransaction(async () => {
      const [location] = await Location.create([input], { session });
      if (!location) throw new Error('Location was not created');
      const result = publicLocation(location);
      await writeAuditLog({
        actorId,
        action: 'location.create',
        entityType: 'location',
        entityId: location._id,
        after: result,
        session,
      });
      return result;
    });
    if (!created) throw new Error('Location transaction completed without a result');
    return created;
  } finally {
    await session.endSession();
  }
}

export async function updateLocation(
  locationId: string,
  input: UpdateLocationInput,
  actorId: string,
) {
  const session = await mongoose.startSession();
  try {
    const updated = await session.withTransaction(async () => {
      const location = await Location.findById(locationId).session(session);
      if (!location) throw AppError.notFound('Location not found');
      const before = publicLocation(location);
      const identityChanged =
        (input.code !== undefined && input.code !== location.code) ||
        (input.type !== undefined && input.type !== location.type);
      if (
        (identityChanged || input.isActive === false) &&
        (await StockMovement.exists({ locationId: location._id }).session(session))
      ) {
        throw AppError.conflict('Stocked location identity and status cannot be changed');
      }
      Object.assign(location, input);
      await location.save({ session });
      const after = publicLocation(location);
      await writeAuditLog({
        actorId,
        action: 'location.update',
        entityType: 'location',
        entityId: location._id,
        before,
        after,
        session,
      });
      return after;
    });
    if (!updated) throw new Error('Location transaction completed without a result');
    return updated;
  } finally {
    await session.endSession();
  }
}
