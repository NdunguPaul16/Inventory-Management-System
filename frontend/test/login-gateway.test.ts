import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleStagingLogin, LOGIN_PATH, STAGING_BACKEND } from '../staging-login-gateway/function';

const key = 'a'.repeat(64);
const source = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging/security-audit',
  STAGING_LOGIN_GATEWAY_KEY_CURRENT: key,
};
const body = { email: 'admin@example.test', password: 'valid-password' };

function login(ip = '203.0.113.1', extraHeaders: Record<string, string> = {}) {
  return new Request(`https://protected-preview.example.test${LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function mockFetch(status = 200, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () =>
    Response.json(
      status === 200
        ? { data: { accessToken: 'test-token' }, meta: {} }
        : { error: { code: 'TEST', message: 'Test' } },
      { status, headers },
    ),
  );
}

function options(fetcher: typeof fetch) {
  return {
    source,
    fetcher,
    now: () => 1_800_000_000_000,
    nonce: () => '1'.repeat(32),
  };
}

function assertion(fetcher: ReturnType<typeof mockFetch>): string {
  const init = fetcher.mock.calls[0]?.[1];
  if (!init) throw new Error('Expected a mocked upstream call');
  return new Headers(init.headers).get('x-ims-staging-login-assertion') ?? '';
}

describe('staging Vercel login Function', () => {
  it('forwards one login with a signed pseudonymous identity, no raw IP or forged headers', async () => {
    const fetcher = mockFetch(200, {
      'set-cookie': 'ims_refresh=test-cookie; HttpOnly; Secure; Path=/api/v1/auth',
    });
    const response = await handleStagingLogin(
      login('203.0.113.1', {
        'x-real-ip': '198.51.100.9',
        'x-ims-staging-login-assertion': 'forged',
        'x-forwarded-host': 'attacker.example',
      }),
      options(fetcher),
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${STAGING_BACKEND}${LOGIN_PATH}`);
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(JSON.stringify(init)).not.toContain('203.0.113.1');
    expect(JSON.stringify(init)).not.toContain('198.51.100.9');
    expect(JSON.stringify(init)).not.toContain('forged');
    expect(assertion(fetcher)).toMatch(/^v1\.\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    expect(response.headers.get('set-cookie')).toContain('ims_refresh=test-cookie');
  });

  it('separates networks while repeated requests from one address retain an identity', async () => {
    const first = mockFetch();
    const second = mockFetch();
    const repeat = mockFetch();
    await handleStagingLogin(login('203.0.113.1'), options(first));
    await handleStagingLogin(login('198.51.100.2'), options(second));
    await handleStagingLogin(login('203.0.113.1'), options(repeat));
    const identity = (value: string) => value.split('.')[3];
    expect(identity(assertion(first))).not.toBe(identity(assertion(second)));
    expect(identity(assertion(first))).toBe(identity(assertion(repeat)));
  });

  it.each([401, 429, 503])('preserves JSON status %i and safe retry headers', async (status) => {
    const fetcher = mockFetch(status, { 'retry-after': '42' });
    const response = await handleStagingLogin(login(), options(fetcher));
    expect(response.status).toBe(status);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['production', { ...source, VERCEL_ENV: 'production' }],
    ['wrong branch', { ...source, VERCEL_GIT_COMMIT_REF: 'dfstock' }],
    ['missing key', { ...source, STAGING_LOGIN_GATEWAY_KEY_CURRENT: undefined }],
  ])('fails closed for %s deployment configuration', async (_name, config) => {
    const fetcher = mockFetch();
    const response = await handleStagingLogin(login(), { ...options(fetcher), source: config });
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['203.0.113.1, 198.51.100.2', 'not-an-ip', ''])(
    'rejects an invalid platform address',
    async (ip) => {
      const fetcher = mockFetch();
      const response = await handleStagingLogin(login(ip), options(fetcher));
      expect(response.status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('stops after an upstream error without retry or redirect', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error('secret network error');
    });
    const response = await handleStagingLogin(login(), options(fetcher));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains only the login Function path ahead of the broad API rewrite', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      rewrites: { source: string; destination: string }[];
    };
    const functionSource = readFileSync(resolve(process.cwd(), 'api/v1/auth/login.ts'), 'utf8');
    expect(functionSource).toContain('handleStagingLogin');
    expect(vercel.rewrites[0]).toEqual({
      source: '/api/:path*',
      destination: `${STAGING_BACKEND}/api/:path*`,
    });
    expect(vercel.rewrites[1]?.destination).toBe('/index.html');
  });

  it('blocks a Vercel production or wrong-branch build and admits only staging Preview', () => {
    const script = resolve(process.cwd(), 'scripts/check-login-gateway-context.mjs');
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, [script], {
        env: { ...process.env, VERCEL_ENV: '', VERCEL_GIT_COMMIT_REF: '', ...env },
        encoding: 'utf8',
      });
    expect(
      run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging/security-audit' }).status,
    ).toBe(0);
    expect(
      run({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'staging/security-audit' }).status,
    ).not.toBe(0);
    expect(run({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dfstock' }).status).not.toBe(0);
    expect(run({}).status).not.toBe(0);
  });
});
