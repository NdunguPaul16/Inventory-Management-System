import { apiErrorSchema, type z } from '@ims/shared';

/** All API calls go through `/api/v1`; Vite proxies it to the server in development. */
export const API_BASE = '/api/v1';

/** An error response from the API, carrying the `{ error: { code, message, details } }` envelope. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Fetches `path` and validates the JSON body with `schema` from `@ims/shared`.
 * Some endpoints (e.g. health when degraded) return a valid body with a non-2xx status,
 * so `acceptStatuses` lets the caller read those bodies instead of throwing.
 */
export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
  options: { signal?: AbortSignal; acceptStatuses?: number[] } = {},
): Promise<z.infer<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal: options.signal,
  });
  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok && !options.acceptStatuses?.includes(res.status)) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, details);
    }
    throw new ApiRequestError(res.status, 'HTTP_ERROR', `Request failed with status ${res.status}`);
  }
  return schema.parse(body);
}
