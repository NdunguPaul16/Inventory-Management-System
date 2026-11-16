import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { loginSchema } from '@ims/shared';

export const LOGIN_PATH = '/api/v1/auth/login';
export const STAGING_BACKEND = 'https://inventory-inc-staging-backend.onrender.com';
const ASSERTION_HEADER = 'x-ims-staging-login-assertion';
const MAX_BODY_BYTES = 8_192;

function failure(status: 400 | 405 | 413 | 503): Response {
  const unavailable = status === 503;
  return Response.json(
    {
      error: unavailable
        ? { code: 'SERVICE_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' }
        : { code: 'VALIDATION_ERROR', message: 'Invalid sign-in request' },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function canonicalIp(value: string | null): string | null {
  if (!value || value.includes(',')) return null;
  const ip = value.startsWith('::ffff:') ? value.slice(7) : value;
  const version = isIP(ip);
  if (!version) return null;
  return version === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

function stagingKey(source: NodeJS.ProcessEnv): Buffer | null {
  if (
    source.VERCEL_ENV !== 'preview' ||
    source.VERCEL_GIT_COMMIT_REF !== 'staging/security-audit'
  ) {
    return null;
  }
  const value = source.STAGING_LOGIN_GATEWAY_KEY_CURRENT;
  return value && /^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, 'hex') : null;
}

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    reader.releaseLock();
  }
}

/** Server-side only. The normal Vite artifact never imports this module. */
export async function handleStagingLogin(
  request: Request,
  options: {
    source?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
    now?: () => number;
    nonce?: () => string;
  } = {},
): Promise<Response> {
  const source = options.source ?? process.env;
  const key = stagingKey(source);
  if (!key) return failure(503);
  if (request.method !== 'POST' || new URL(request.url).pathname !== LOGIN_PATH) {
    return failure(405);
  }
  if (new URL(request.url).search) return failure(400);
  const ip = canonicalIp(request.headers.get('x-forwarded-for'));
  if (!ip) return failure(503);
  let body: string | null;
  try {
    body = await boundedBody(request);
  } catch {
    return failure(400);
  }
  if (body === null) return failure(413);
  let parsed: ReturnType<typeof loginSchema.safeParse>;
  try {
    parsed = loginSchema.safeParse(JSON.parse(body));
  } catch {
    return failure(400);
  }
  if (!parsed.success) return failure(400);

  const timestamp = String((options.now ?? Date.now)());
  const nonce = (options.nonce ?? (() => randomBytes(16).toString('hex')))();
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce)) return failure(503);
  const normalizedBody = JSON.stringify(parsed.data);
  const identity = createHmac('sha256', key).update(`client-ip\0${ip}`).digest('hex');
  const bodyHash = createHash('sha256').update(normalizedBody).digest('hex');
  const signed = [
    'ims-login-v1',
    request.method,
    LOGIN_PATH,
    timestamp,
    nonce,
    identity,
    bodyHash,
  ].join('\n');
  const signature = createHmac('sha256', key).update(signed).digest('hex');
  const assertion = `v1.${timestamp}.${nonce}.${identity}.${signature}`;

  try {
    const upstream = await (options.fetcher ?? fetch)(`${STAGING_BACKEND}${LOGIN_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [ASSERTION_HEADER]: assertion,
      },
      body: normalizedBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) return failure(503);
    if (!upstream.headers.get('content-type')?.startsWith('application/json')) return failure(503);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    for (const cookie of upstream.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter && /^\d{1,10}$/.test(retryAfter)) headers.set('Retry-After', retryAfter);
    const requestId = upstream.headers.get('x-request-id');
    if (requestId && /^[\w-]{1,100}$/.test(requestId)) headers.set('X-Request-Id', requestId);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return failure(503);
  }
}
