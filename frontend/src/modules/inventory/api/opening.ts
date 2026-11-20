import { apiSuccessSchema, objectIdSchema, z, type OpeningStockInput } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const statusSchema = z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']);
const openingRecordSchema = z.object({
  id: objectIdSchema,
  actionNo: z.string(),
  actionType: z.literal('OPENING'),
  status: statusSchema,
  payload: z.object({
    itemId: objectIdSchema,
    locationId: objectIdSchema,
    quantity: z.string(),
    unitCost: z.number().int().nonnegative(),
    sourceDoc: z.object({ type: z.string(), id: z.string(), number: z.string() }),
    receivedAt: z.iso.datetime().optional(),
    serialNumbers: z.array(z.string()).optional(),
  }),
  requestedBy: objectIdSchema,
  approvedBy: objectIdSchema.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type OpeningRecord = z.infer<typeof openingRecordSchema>;
export type OpeningStatus = z.infer<typeof statusSchema>;

export async function listOpeningRequests(
  request: Request,
  status?: OpeningStatus,
  before?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ actionType: 'OPENING', limit: '20' });
  if (status) params.set('status', status);
  if (before) params.set('before', before);
  return (
    await request(`/inventory/requests?${params}`, apiSuccessSchema(z.array(openingRecordSchema)), {
      signal,
    })
  ).data;
}

export async function requestOpeningStock(request: Request, input: OpeningStockInput) {
  return (
    await request('/inventory/opening-stock', apiSuccessSchema(openingRecordSchema), {
      method: 'POST',
      body: input,
    })
  ).data;
}

export async function approveOpeningStock(request: Request, id: string) {
  return (
    await request(`/inventory/requests/${id}/approve`, apiSuccessSchema(openingRecordSchema), {
      method: 'POST',
    })
  ).data;
}

export async function rejectOpeningStock(request: Request, id: string, reason: string) {
  return (
    await request(`/inventory/requests/${id}/reject`, apiSuccessSchema(openingRecordSchema), {
      method: 'POST',
      body: { reason },
    })
  ).data;
}

export async function postOpeningStockRequest(request: Request, id: string) {
  return (
    await request(
      `/inventory/requests/${id}/post`,
      apiSuccessSchema(z.object({ request: openingRecordSchema })),
      { method: 'POST' },
    )
  ).data;
}
