import { apiSuccessSchema, objectIdSchema, z } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

const differenceSchema = z.object({
  itemId: objectIdSchema,
  locationId: objectIdSchema,
  balanceQty: z.string(),
  ledgerQty: z.string(),
  layerQty: z.string(),
  balanceValue: z.number().int(),
  ledgerValue: z.number().int(),
  layerValue: z.number().int(),
});

const reconciliationSchema = z.object({
  checked: z.number().int().nonnegative(),
  differences: z.array(differenceSchema),
});

export type ReconciliationResult = z.infer<typeof reconciliationSchema>;

export async function runReconciliation(
  request: AuthContextValue['authorizedRequest'],
): Promise<ReconciliationResult> {
  return (await request('/inventory/reconciliation', apiSuccessSchema(reconciliationSchema))).data;
}
