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

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  signal?: AbortSignal;
  acceptStatuses?: number[];
}

function errorForResponse(res: Response, body: unknown): ApiRequestError {
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiRequestError(res.status, code, message, details);
  }
  return new ApiRequestError(res.status, 'HTTP_ERROR', `Request failed with status ${res.status}`);
}

/** Keeps cookie handling on the same-origin API; access tokens stay in memory. */
export async function apiRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  options: ApiRequestOptions = {},
): Promise<z.infer<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    credentials: 'include',
    signal: options.signal,
  });
  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok && !options.acceptStatuses?.includes(res.status)) {
    throw errorForResponse(res, body);
  }
  return schema.parse(body);
}

export async function apiNoContent(path: string, options: ApiRequestOptions = {}): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'include',
    signal: options.signal,
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    throw errorForResponse(res, body);
  }
}

/** Existing read helper, including health's accepted 503 response. */
export function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
  options: Pick<ApiRequestOptions, 'signal' | 'acceptStatuses'> = {},
): Promise<z.infer<T>> {
  return apiRequest(path, schema, options);
}
