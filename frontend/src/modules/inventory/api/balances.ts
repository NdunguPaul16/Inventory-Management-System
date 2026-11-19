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

export const BALANCE_PAGE_SIZE = 20;

export async function getBalances(
  request: AuthContextValue['authorizedRequest'],
  signal?: AbortSignal,
  options: {
    itemId?: string;
    locationId?: string;
    q?: string;
    before?: string;
    limit?: number;
  } = {},
): Promise<BalanceRecord[]> {
  const params = new URLSearchParams({ limit: String(options.limit ?? BALANCE_PAGE_SIZE) });
  if (options.itemId) params.set('itemId', options.itemId);
  if (options.locationId) params.set('locationId', options.locationId);
  if (options.q) params.set('q', options.q);
  if (options.before) params.set('before', options.before);
  const path = `/inventory/balances?${params}`;
  return (await request(path, balancesResponseSchema, { signal })).data;
}
