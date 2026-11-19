import { z } from 'zod';
import { objectIdSchema } from './inventory.js';

export const ITEM_TYPES = [
  'RAW_MATERIAL',
  'COMPONENT',
  'FINISHED_GOOD',
  'TRADING_GOOD',
  'CONSUMABLE',
  'SERVICE',
] as const;
export const LOCATION_TYPES = ['WAREHOUSE', 'WORKSHOP', 'SHOWROOM', 'IN_TRANSIT'] as const;

const code = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.toUpperCase());
const name = z.string().trim().min(2).max(160);

const itemFields = z.strictObject({
  sku: code,
  name,
  type: z.enum(ITEM_TYPES),
  baseUnit: code,
  trackSerial: z.boolean(),
  trackBatch: z.boolean(),
});
export const createItemSchema = itemFields.extend({
  trackSerial: z.boolean().default(false),
  trackBatch: z.boolean().default(false),
});
export const updateItemSchema = itemFields
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

export const createLocationSchema = z.strictObject({
  code,
  name,
  type: z.enum(LOCATION_TYPES),
});
export const updateLocationSchema = createLocationSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

export const masterDataQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type MasterDataQuery = z.infer<typeof masterDataQuerySchema>;
