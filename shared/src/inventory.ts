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
  .regex(/^\d+(?:\.\d+)?$/, 'must be a positive decimal quantity');
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
  actionType: z.enum(['OPENING', 'ADJUSTMENT', 'REVERSAL']).optional(),
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

export type OpeningStockInput = z.infer<typeof openingStockSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type TransferStockInput = z.infer<typeof transferSchema>;
