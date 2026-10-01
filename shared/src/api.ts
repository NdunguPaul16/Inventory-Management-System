import { z } from 'zod';

/** Machine-readable error codes used in the `{ error: { code } }` envelope. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_STOCK',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Error envelope: `{ error: { code, message, details } }` (spec §2.2). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Pagination and other response metadata. */
export const metaSchema = z.record(z.string(), z.unknown());
export type Meta = z.infer<typeof metaSchema>;

/** Success envelope: `{ data, meta }` (spec §2.2). */
export interface ApiSuccess<T> {
  data: T;
  meta: Meta;
}

/** Builds a zod schema for a success envelope around `data`. */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: metaSchema });
}
