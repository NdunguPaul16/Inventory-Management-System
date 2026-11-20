import type { z, stockReferenceQuerySchema } from '@ims/shared';
import { Item } from './items/model.js';
import { Location } from './locations/model.js';

type Query = z.infer<typeof stockReferenceQuerySchema>;

function safeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

async function listStockItems(query: Query) {
  const search = query.q ? safeRegex(query.q) : undefined;
  const items = await Item.find({
    isActive: true,
    type: { $ne: 'SERVICE' },
    ...(search ? { $or: [{ sku: search }, { name: search }] } : {}),
  })
    .sort({ sku: 1, _id: 1 })
    .limit(query.limit)
    .lean();
  return items.map((item) => ({
    id: String(item._id),
    sku: item.sku,
    name: item.name,
    baseUnit: item.baseUnit,
    trackSerial: item.trackSerial,
  }));
}

export function listCountableItems(query: Query) {
  return listStockItems(query);
}

export function listActiveStockItems(query: Query) {
  return listStockItems(query);
}

export async function listCountLocations(query: Query) {
  const search = query.q ? safeRegex(query.q) : undefined;
  const locations = await Location.find({
    isActive: true,
    ...(search ? { $or: [{ code: search }, { name: search }] } : {}),
  })
    .sort({ code: 1, _id: 1 })
    .limit(query.limit)
    .lean();
  return locations.map((location) => ({
    id: String(location._id),
    code: location.code,
    name: location.name,
  }));
}
