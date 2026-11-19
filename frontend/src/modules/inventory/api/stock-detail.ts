import { apiSuccessSchema, objectIdSchema, z } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';
import { decimalSchema } from './balances';

const layerSchema = z.object({
  _id: objectIdSchema,
  receivedAt: z.iso.datetime(),
  originalQty: decimalSchema,
  remainingQty: decimalSchema,
  originalValue: z.number().int().nonnegative().optional(),
  remainingValue: z.number().int().nonnegative().optional(),
  unitCost: z.number().int().nonnegative(),
  sourceDoc: z.object({ type: z.string(), id: z.string(), number: z.string() }),
});

const movementSchema = z.object({
  _id: objectIdSchema,
  movementNo: z.string(),
  direction: z.enum(['IN', 'OUT']),
  quantity: decimalSchema,
  movementType: z.string(),
  totalCost: z.number().int().nonnegative(),
  sourceDoc: z.object({ type: z.string(), id: z.string(), number: z.string() }),
  postedAt: z.iso.datetime(),
});

export type LayerRecord = z.infer<typeof layerSchema>;
export type MovementRecord = z.infer<typeof movementSchema>;

const layerResponseSchema = apiSuccessSchema(z.array(layerSchema));
const movementResponseSchema = apiSuccessSchema(z.array(movementSchema));

export async function getItemLayers(
  request: AuthContextValue['authorizedRequest'],
  itemId: string,
  locationId: string,
  signal?: AbortSignal,
): Promise<LayerRecord[]> {
  const path = `/inventory/items/${encodeURIComponent(itemId)}/layers?locationId=${encodeURIComponent(locationId)}`;
  return (await request(path, layerResponseSchema, { signal })).data;
}

export async function getItemMovements(
  request: AuthContextValue['authorizedRequest'],
  itemId: string,
  locationId: string,
  signal?: AbortSignal,
  before?: string,
): Promise<MovementRecord[]> {
  const path = `/inventory/items/${encodeURIComponent(itemId)}/movements?locationId=${encodeURIComponent(locationId)}&limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`;
  return (await request(path, movementResponseSchema, { signal })).data;
}
