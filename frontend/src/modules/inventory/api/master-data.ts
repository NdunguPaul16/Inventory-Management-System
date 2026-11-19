import { apiSuccessSchema, ITEM_TYPES, LOCATION_TYPES, objectIdSchema, z } from '@ims/shared';
import type {
  CreateItemInput,
  CreateLocationInput,
  UpdateItemInput,
  UpdateLocationInput,
} from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

export const itemRecordSchema = z.object({
  id: objectIdSchema,
  sku: z.string(),
  name: z.string(),
  type: z.enum(ITEM_TYPES),
  baseUnit: z.string(),
  trackSerial: z.boolean(),
  trackBatch: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const locationRecordSchema = z.object({
  id: objectIdSchema,
  code: z.string(),
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ItemRecord = z.infer<typeof itemRecordSchema>;
export type LocationRecord = z.infer<typeof locationRecordSchema>;

function queryPath(kind: 'items' | 'locations', q: string, status: string, before?: string) {
  const params = new URLSearchParams({ q, status, limit: '20' });
  if (before) params.set('before', before);
  return `/inventory/${kind}?${params}`;
}

export async function listItems(
  request: Request,
  q: string,
  status: string,
  before?: string,
  signal?: AbortSignal,
) {
  return (
    await request(
      queryPath('items', q, status, before),
      apiSuccessSchema(z.array(itemRecordSchema)),
      { signal },
    )
  ).data;
}

export async function listLocations(
  request: Request,
  q: string,
  status: string,
  before?: string,
  signal?: AbortSignal,
) {
  return (
    await request(
      queryPath('locations', q, status, before),
      apiSuccessSchema(z.array(locationRecordSchema)),
      { signal },
    )
  ).data;
}

export async function createItem(request: Request, input: CreateItemInput) {
  return (
    await request('/inventory/items', apiSuccessSchema(itemRecordSchema), {
      method: 'POST',
      body: input,
    })
  ).data;
}

export async function updateItem(request: Request, id: string, input: UpdateItemInput) {
  return (
    await request(
      `/inventory/items/${encodeURIComponent(id)}`,
      apiSuccessSchema(itemRecordSchema),
      { method: 'PATCH', body: input },
    )
  ).data;
}

export async function createLocation(request: Request, input: CreateLocationInput) {
  return (
    await request('/inventory/locations', apiSuccessSchema(locationRecordSchema), {
      method: 'POST',
      body: input,
    })
  ).data;
}

export async function updateLocation(request: Request, id: string, input: UpdateLocationInput) {
  return (
    await request(
      `/inventory/locations/${encodeURIComponent(id)}`,
      apiSuccessSchema(locationRecordSchema),
      { method: 'PATCH', body: input },
    )
  ).data;
}
