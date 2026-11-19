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
const nonnegativeQuantity = z
  .string()
  .trim()
  .max(80)
  .regex(/^\d+(?:\.\d+)?$/, 'must be a nonnegative decimal quantity');
const quantity = nonnegativeQuantity.refine(
  (value) => /[1-9]/.test(value),
  'must be greater than zero',
);
export const unitConversionSchema = z.strictObject({
  unit: code,
  baseQuantity: quantity,
});
const conversions = z
  .array(unitConversionSchema)
  .max(20)
  .refine((values) => new Set(values.map((value) => value.unit)).size === values.length, {
    message: 'conversion units must be unique',
  });

const itemFields = z.strictObject({
  sku: code,
  name,
  type: z.enum(ITEM_TYPES),
  baseUnit: code,
  description: z.string().trim().max(2000).optional(),
  unitConversions: conversions.optional(),
  reorderLevel: nonnegativeQuantity.nullable().optional(),
  reorderQty: quantity.nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  trackSerial: z.boolean(),
  trackBatch: z.boolean(),
});
export const createItemSchema = itemFields
  .extend({
    trackSerial: z.boolean().default(false),
    trackBatch: z.boolean().default(false),
  })
  .refine(
    (value) => !value.unitConversions?.some((conversion) => conversion.unit === value.baseUnit),
    { message: 'conversion unit must differ from the base unit', path: ['unitConversions'] },
  );
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
