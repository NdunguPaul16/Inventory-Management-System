import { apiSuccessSchema, objectIdSchema, z, type AdjustmentInput } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const statusSchema = z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']);
const adjustmentSchema = z.object({
  id: objectIdSchema,
  actionNo: z.string(),
  actionType: z.literal('ADJUSTMENT'),
  status: statusSchema,
  payload: z.object({
    itemId: objectIdSchema,
    locationId: objectIdSchema,
    quantity: z.string(),
    direction: z.enum(['IN', 'OUT']),
    unitCost: z.number().int().nonnegative().optional(),
    reason: z.string(),
    sourceDoc: z.object({ type: z.string(), id: z.string(), number: z.string() }),
    serialNumbers: z.array(z.string()).optional(),
  }),
  requestedBy: objectIdSchema,
  approvedBy: objectIdSchema.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  rejectedBy: objectIdSchema.nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  postedBy: objectIdSchema.nullable(),
  postedAt: z.iso.datetime().nullable(),
  movementIds: z.array(objectIdSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AdjustmentRecord = z.infer<typeof adjustmentSchema>;
export type AdjustmentStatus = z.infer<typeof statusSchema>;

const actionResponse = apiSuccessSchema(adjustmentSchema);

export async function listAdjustments(
  request: Request,
  status?: AdjustmentStatus,
  before?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ actionType: 'ADJUSTMENT', limit: '20' });
  if (status) params.set('status', status);
  if (before) params.set('before', before);
  return (
    await request(`/inventory/requests?${params}`, apiSuccessSchema(z.array(adjustmentSchema)), {
      signal,
    })
  ).data;
}

export async function requestAdjustment(request: Request, input: AdjustmentInput) {
  return (await request('/inventory/adjustments', actionResponse, { method: 'POST', body: input }))
    .data;
}

export async function approveAdjustment(request: Request, id: string) {
  return (await request(`/inventory/requests/${id}/approve`, actionResponse, { method: 'POST' }))
    .data;
}

export async function rejectAdjustment(request: Request, id: string, reason: string) {
  return (
    await request(`/inventory/requests/${id}/reject`, actionResponse, {
      method: 'POST',
      body: { reason },
    })
  ).data;
}

export async function postAdjustment(request: Request, id: string) {
  return (
    await request(
      `/inventory/requests/${id}/post`,
      apiSuccessSchema(
        z.object({
          request: adjustmentSchema,
          posting: z.object({ movementIds: z.array(objectIdSchema), replayed: z.boolean() }),
        }),
      ),
      { method: 'POST' },
    )
  ).data;
}
