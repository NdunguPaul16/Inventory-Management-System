import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid object id');
export const sourceDocumentSchema = z.object({
  type: z.string().trim().min(1).max(40),
  id: z.string().trim().min(1).max(100),
  number: z.string().trim().min(1).max(80),
  lineId: z.string().trim().min(1).max(100).optional(),
});

const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, 'must be a positive decimal quantity')
  .refine((value) => /[1-9]/.test(value), 'must be greater than zero');
const serialNumbersSchema = z.array(z.string().trim().min(1).max(100)).max(10_000).optional();

export const openingStockSchema = z.object({
  itemId: objectIdSchema,
  locationId: objectIdSchema,
  quantity: quantitySchema,
  unitCost: z.number().int().nonnegative().safe(),
  sourceDoc: sourceDocumentSchema,
  receivedAt: z.iso.datetime().optional(),
  serialNumbers: serialNumbersSchema,
});

export const openingStockBatchSchema = z.object({
  sourceDoc: sourceDocumentSchema,
  lines: z
    .array(
      openingStockSchema.omit({ sourceDoc: true }).extend({
        lineId: z.string().trim().min(1).max(100),
        sku: z.string().trim().min(1).max(80).optional(),
        locationCode: z.string().trim().min(1).max(80).optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, {
      message: 'Opening-stock line IDs must be unique',
    }),
});

export const openingStockImportSchema = z.object({
  sourceDoc: sourceDocumentSchema,
  lines: z
    .array(
      openingStockSchema.omit({ itemId: true, locationId: true, sourceDoc: true }).extend({
        lineId: z.string().trim().min(1).max(100),
        sku: z.string().trim().min(1).max(80),
        locationCode: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(100)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, {
      message: 'Opening-stock line IDs must be unique',
    }),
});

export const adjustmentSchema = z.object({
  itemId: objectIdSchema,
  locationId: objectIdSchema,
  quantity: quantitySchema,
  direction: z.enum(['IN', 'OUT']),
  unitCost: z.number().int().nonnegative().safe().optional(),
  reason: z.string().trim().min(3).max(500),
  sourceDoc: sourceDocumentSchema,
  serialNumbers: serialNumbersSchema,
});

export const transferSchema = z.object({
  itemId: objectIdSchema,
  fromLocationId: objectIdSchema,
  toLocationId: objectIdSchema,
  quantity: quantitySchema,
  sourceDoc: sourceDocumentSchema,
  serialNumbers: serialNumbersSchema,
});

export const reverseMovementSchema = z.object({ movementId: objectIdSchema });

export const reversalRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const stockActionQuerySchema = z.object({
  actionType: z.enum(['OPENING', 'OPENING_BATCH', 'ADJUSTMENT', 'REVERSAL']).optional(),
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']).optional(),
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const rejectStockActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const stockQuerySchema = z.object({
  itemId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Historical stock is valued at the time each movement was posted, in UTC. */
export const stockValuationQuerySchema = z.object({
  asAt: z.iso.datetime(),
  itemId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
});

export const freezeStockCountSchema = z.object({
  itemId: objectIdSchema,
  locationId: objectIdSchema,
});

export const enterStockCountSchema = z.object({
  countedQuantity: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/, 'must be a non-negative decimal'),
  inboundUnitCost: z.number().int().nonnegative().safe().optional(),
  reason: z.string().trim().min(3).max(500),
});

export const enterSerialStockCountSchema = z.object({
  serialNumbers: z.array(z.string().trim().min(1).max(100)).max(10_000),
  inboundUnitCost: z.number().int().nonnegative().safe().optional(),
  reason: z.string().trim().min(3).max(500),
});

export const rejectStockCountSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const stockCountQuerySchema = z.object({
  status: z.enum(['FROZEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED']).optional(),
  itemId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const stockReferenceQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const stockCountOptionQuerySchema = stockReferenceQuerySchema;

export type OpeningStockInput = z.infer<typeof openingStockSchema>;
export type OpeningStockBatchInput = z.infer<typeof openingStockBatchSchema>;
export type OpeningStockImportInput = z.infer<typeof openingStockImportSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type TransferStockInput = z.infer<typeof transferSchema>;
