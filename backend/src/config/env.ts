import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from '@ims/shared';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

function validProxyRange(value: string): boolean {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(value)) return true;
  const [address, prefix, extra] = value.split('/');
  if (!address || extra !== undefined) return false;
  const version = isIP(address);
  if (!version) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (version === 4 ? 32 : 128);
}

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
    AUTH_ACCESS_TOKEN_SECRET: z
      .string()
      .min(32)
      .default('development-access-token-secret-change-before-production'),
    AUTH_REFRESH_TOKEN_SECRET: z
      .string()
      .min(32)
      .default('development-refresh-token-secret-change-before-production'),
    /** Internal Render Key Value URL. Required for shared production login counters. */
    AUTH_RATE_LIMIT_REDIS_URL: optionalString.refine(
      (v) => v === undefined || /^rediss?:\/\//.test(v),
      'must be a redis:// or rediss:// URL',
    ),
    /** Only explicitly verified proxy IP ranges may supply X-Forwarded-For. */
    AUTH_TRUSTED_PROXY_CIDRS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    AUTH_LOGIN_LIMIT_PER_IP_MINUTE: z.coerce.number().int().min(1).max(1_000).default(10),
    AUTH_LOGIN_LIMIT_PER_IP_HOUR: z.coerce.number().int().min(1).max(10_000).default(60),
    AUTH_LOGIN_LIMIT_PER_ACCOUNT_15_MIN: z.coerce.number().int().min(1).max(1_000).default(5),
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
    if (env.NODE_ENV === 'production' && !env.AUTH_RATE_LIMIT_REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_RATE_LIMIT_REDIS_URL'],
        message: 'AUTH_RATE_LIMIT_REDIS_URL is required in production',
      });
    }
    for (const [index, range] of env.AUTH_TRUSTED_PROXY_CIDRS.entries()) {
      if (!validProxyRange(range)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_TRUSTED_PROXY_CIDRS', index],
          message: 'must be a valid IP/CIDR range or a known proxy group',
        });
      }
    }
    if (
      env.NODE_ENV === 'production' &&
      (env.AUTH_ACCESS_TOKEN_SECRET.startsWith('development-') ||
        env.AUTH_REFRESH_TOKEN_SECRET.startsWith('development-'))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_ACCESS_TOKEN_SECRET'],
        message:
          'production requires unique AUTH_ACCESS_TOKEN_SECRET and AUTH_REFRESH_TOKEN_SECRET values',
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
