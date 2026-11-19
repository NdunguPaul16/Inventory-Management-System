import { apiSuccessSchema, objectIdSchema, z, type OpeningStockImportInput } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const batchRecordSchema = z.object({
  id: objectIdSchema,
  actionNo: z.string(),
  actionType: z.literal('OPENING_BATCH'),
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']),
  payload: z.object({
    sourceDoc: z.object({ type: z.string(), id: z.string(), number: z.string() }),
    lines: z.array(
      z.object({
        lineId: z.string(),
        itemId: objectIdSchema,
        locationId: objectIdSchema,
        sku: z.string().optional(),
        locationCode: z.string().optional(),
        quantity: z.string(),
        unitCost: z.number().int().nonnegative(),
        receivedAt: z.iso.datetime().optional(),
        serialNumbers: z.array(z.string()).optional(),
      }),
    ),
  }),
  requestedBy: objectIdSchema,
  approvedBy: objectIdSchema.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type OpeningBatchRecord = z.infer<typeof batchRecordSchema>;

export async function listOpeningBatches(request: Request, before?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ actionType: 'OPENING_BATCH', limit: '20' });
  if (before) params.set('before', before);
  return (
    await request(`/inventory/requests?${params}`, apiSuccessSchema(z.array(batchRecordSchema)), {
      signal,
    })
  ).data;
}

export async function requestOpeningImport(request: Request, input: OpeningStockImportInput) {
  return (
    await request('/inventory/opening-stock/imports', apiSuccessSchema(batchRecordSchema), {
      method: 'POST',
      body: input,
    })
  ).data;
}

export async function approveOpeningBatch(request: Request, id: string) {
  return (
    await request(`/inventory/requests/${id}/approve`, apiSuccessSchema(batchRecordSchema), {
      method: 'POST',
    })
  ).data;
}

export async function rejectOpeningBatch(request: Request, id: string, reason: string) {
  return (
    await request(`/inventory/requests/${id}/reject`, apiSuccessSchema(batchRecordSchema), {
      method: 'POST',
      body: { reason },
    })
  ).data;
}

export async function postOpeningBatch(request: Request, id: string) {
  return (
    await request(
      `/inventory/requests/${id}/post`,
      apiSuccessSchema(z.object({ request: batchRecordSchema })),
      { method: 'POST' },
    )
  ).data;
}
