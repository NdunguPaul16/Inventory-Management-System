import { z } from 'zod';
import { apiSuccessSchema } from './api.js';

export const DB_STATES = [
  'connected',
  'connecting',
  'disconnected',
  'disconnecting',
  'unknown',
] as const;

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  app: z.object({
    name: z.string(),
    version: z.string(),
    environment: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  }),
  db: z.object({
    status: z.enum(['up', 'down']),
    state: z.enum(DB_STATES),
    latencyMs: z.number().nonnegative().nullable(),
  }),
  time: z.iso.datetime(),
});
export type Health = z.infer<typeof healthSchema>;

export const healthResponseSchema = apiSuccessSchema(healthSchema);
export type HealthResponse = z.infer<typeof healthResponseSchema>;
