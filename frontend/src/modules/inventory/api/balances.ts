import { apiSuccessSchema, objectIdSchema, z } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

export const decimalSchema = z.object({ $numberDecimal: z.string() });

const balanceSchema = z.object({
  _id: objectIdSchema,
  itemId: z.object({
    _id: objectIdSchema,
    sku: z.string(),
    name: z.string(),
    type: z.string(),
    baseUnit: z.string(),
  }),
  locationId: z.object({
    _id: objectIdSchema,
    code: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  onHand: decimalSchema,
  reserved: decimalSchema,
  value: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  lastMovementAt: z.iso.datetime().optional(),
});

const balancesResponseSchema = apiSuccessSchema(z.array(balanceSchema));
export type BalanceRecord = z.infer<typeof balanceSchema>;

export async function getBalances(
  request: AuthContextValue['authorizedRequest'],
  signal?: AbortSignal,
  itemId?: string,
): Promise<BalanceRecord[]> {
  const path = itemId
    ? `/inventory/balances?itemId=${encodeURIComponent(itemId)}`
    : '/inventory/balances';
  return (await request(path, balancesResponseSchema, { signal })).data;
}
