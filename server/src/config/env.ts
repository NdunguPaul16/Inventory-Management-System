import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from '@ims/shared';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Must point at a replica set (Atlas always is one): stock postings need transactions. */
    MONGODB_URI: optionalString.refine(
      (v) => v === undefined || /^mongodb(\+srv)?:\/\//.test(v),
      'must be a mongodb:// or mongodb+srv:// URI',
    ),
    MONGODB_DB_NAME: z.string().trim().min(1).default('ims'),
    /** Comma-separated list of origins allowed by CORS. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.MONGODB_URI) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI is required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parses and validates environment variables. Throws a readable error on failure. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Loads the repo-root `.env` file if there is one. Variables that are already set win. */
export function loadEnvFile(): void {
  // src/config/env.ts and dist/config/env.js both sit three levels below the repo root.
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
