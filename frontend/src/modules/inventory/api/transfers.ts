import { apiSuccessSchema, objectIdSchema, z, type TransferStockInput } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const movementResultSchema = z.object({
  movementIds: z.array(objectIdSchema),
  movements: z.array(
    z.object({
      id: objectIdSchema,
      movementNo: z.string(),
      direction: z.enum(['IN', 'OUT']),
      quantity: z.string(),
      totalCost: z.number().int(),
    }),
  ),
  replayed: z.boolean(),
});

export async function postTransfer(
  request: Request,
  input: TransferStockInput,
  idempotencyKey: string,
) {
  return (
    await request('/inventory/transfers', apiSuccessSchema(movementResultSchema), {
      method: 'POST',
      body: input,
      idempotencyKey,
    })
  ).data;
}
