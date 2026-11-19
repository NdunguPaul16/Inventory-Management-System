import { apiSuccessSchema, objectIdSchema, z } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const statusSchema = z.enum(['FROZEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']);
const countSchema = z.object({
  id: objectIdSchema,
  countNo: z.string(),
  itemId: objectIdSchema,
  locationId: objectIdSchema,
  item: z.object({ sku: z.string(), name: z.string() }).nullable().optional(),
  location: z.object({ code: z.string(), name: z.string() }).nullable().optional(),
  status: statusSchema,
  mode: z.enum(['QUANTITY', 'SERIAL']).default('QUANTITY'),
  bookQuantity: z.string(),
  bookSerialNumbers: z.array(z.string()).nullable().default(null),
  bookValue: z.number().int().nonnegative(),
  bookVersion: z.number().int().nonnegative(),
  frozenAt: z.iso.datetime(),
  frozenBy: objectIdSchema,
  countedQuantity: z.string().nullable(),
  countedSerialNumbers: z.array(z.string()).nullable().default(null),
  varianceQuantity: z.string().nullable(),
  inboundUnitCost: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
  countedAt: z.iso.datetime().nullable(),
  countedBy: objectIdSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  approvedBy: objectIdSchema.nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rejectedBy: objectIdSchema.nullable(),
  rejectionReason: z.string().nullable(),
  postedAt: z.iso.datetime().nullable(),
  postedBy: objectIdSchema.nullable(),
  movementIds: z.array(objectIdSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const itemOptionSchema = z.object({
  id: objectIdSchema,
  sku: z.string(),
  name: z.string(),
  baseUnit: z.string(),
  trackSerial: z.boolean().default(false),
});
const locationOptionSchema = z.object({ id: objectIdSchema, code: z.string(), name: z.string() });

export type CountRecord = z.infer<typeof countSchema>;
export type CountStatus = z.infer<typeof statusSchema>;
export type CountItemOption = z.infer<typeof itemOptionSchema>;
export type CountLocationOption = z.infer<typeof locationOptionSchema>;

const countResponse = apiSuccessSchema(countSchema);
const countsResponse = apiSuccessSchema(z.array(countSchema));

export async function getCounts(
  request: Request,
  status?: CountStatus,
  before?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: '20' });
  if (status) params.set('status', status);
  if (before) params.set('before', before);
  return (await request(`/inventory/counts?${params}`, countsResponse, { signal })).data;
}

export async function getCountItems(request: Request, q: string, signal?: AbortSignal) {
  return (
    await request(
      `/inventory/counts/options/items?q=${encodeURIComponent(q)}`,
      apiSuccessSchema(z.array(itemOptionSchema)),
      { signal },
    )
  ).data;
}

export async function getCountLocations(request: Request, q: string, signal?: AbortSignal) {
  return (
    await request(
      `/inventory/counts/options/locations?q=${encodeURIComponent(q)}`,
      apiSuccessSchema(z.array(locationOptionSchema)),
      { signal },
    )
  ).data;
}

export async function freezeCount(request: Request, itemId: string, locationId: string) {
  return (
    await request('/inventory/counts', countResponse, {
      method: 'POST',
      body: { itemId, locationId },
    })
  ).data;
}

export async function enterCount(
  request: Request,
  id: string,
  input: { countedQuantity: string; reason: string; inboundUnitCost?: number },
) {
  return (
    await request(`/inventory/counts/${encodeURIComponent(id)}/entry`, countResponse, {
      method: 'PATCH',
      body: input,
    })
  ).data;
}

export async function enterSerialCount(
  request: Request,
  id: string,
  input: { serialNumbers: string[]; reason: string; inboundUnitCost?: number },
) {
  return (
    await request(`/inventory/counts/${encodeURIComponent(id)}/serial-entry`, countResponse, {
      method: 'PATCH',
      body: input,
    })
  ).data;
}

export async function approveCount(request: Request, id: string) {
  return (
    await request(`/inventory/counts/${encodeURIComponent(id)}/approve`, countResponse, {
      method: 'POST',
    })
  ).data;
}

export async function rejectCount(request: Request, id: string, reason: string) {
  return (
    await request(`/inventory/counts/${encodeURIComponent(id)}/reject`, countResponse, {
      method: 'POST',
      body: { reason },
    })
  ).data;
}

export async function postCount(request: Request, id: string) {
  return (
    await request(`/inventory/counts/${encodeURIComponent(id)}/post`, countResponse, {
      method: 'POST',
    })
  ).data;
}
