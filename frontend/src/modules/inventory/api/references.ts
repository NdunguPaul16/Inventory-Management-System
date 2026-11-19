import { apiSuccessSchema, objectIdSchema, z } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type Request = AuthContextValue['authorizedRequest'];

const stockItemSchema = z.object({
  id: objectIdSchema,
  sku: z.string(),
  name: z.string(),
  baseUnit: z.string(),
  trackSerial: z.boolean(),
});
const stockLocationSchema = z.object({ id: objectIdSchema, code: z.string(), name: z.string() });

export type StockItemOption = z.infer<typeof stockItemSchema>;
export type StockLocationOption = z.infer<typeof stockLocationSchema>;

export async function getStockItemOptions(request: Request, q: string, signal?: AbortSignal) {
  return (
    await request(
      `/inventory/options/items?q=${encodeURIComponent(q)}`,
      apiSuccessSchema(z.array(stockItemSchema)),
      { signal },
    )
  ).data;
}

export async function getStockLocationOptions(request: Request, q: string, signal?: AbortSignal) {
  return (
    await request(
      `/inventory/options/locations?q=${encodeURIComponent(q)}`,
      apiSuccessSchema(z.array(stockLocationSchema)),
      { signal },
    )
  ).data;
}
