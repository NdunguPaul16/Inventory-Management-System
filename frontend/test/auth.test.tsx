import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from '@ims/shared';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';
import { AuthProvider } from '../src/modules/auth/AuthProvider';
import { useAuth } from '../src/modules/auth/auth-context';

const unauthenticated = {
  error: { code: 'UNAUTHENTICATED', message: 'Refresh session is required' },
};

function anonymousFetch(loginStatus = 200, loginMessage = '') {
  const fn = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(401, unauthenticated);
    if (url === '/api/v1/auth/login') {
      return loginStatus === 200
        ? jsonResponse(200, sessionBody())
        : jsonResponse(loginStatus, { error: { code: 'UNAUTHENTICATED', message: loginMessage } });
    }
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: testUser(), meta: {} });
    return jsonResponse(200, healthBody());
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function fillLogin(email = 'admin@example.com', password = 'correct-password') {
  await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('frontend authentication', () => {
  it('redirects an expired session to login and preserves the requested route', async () => {
    const fetchMock = anonymousFetch();
    renderRoute('/inventory/balances');

    expect(
      await screen.findByRole('heading', { name: 'Sign in to your account' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/refresh',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('validates fields and toggles password visibility before submitting', async () => {
    const fetchMock = anonymousFetch();
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in to your account' });

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/auth/login')).toBe(false);

    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('logs in, fetches /auth/me and returns to the protected page', async () => {
    const fetchMock = anonymousFetch();
    renderRoute('/inventory/balances');
    await screen.findByRole('heading', { name: 'Sign in to your account' });
    await fillLogin('Admin@Example.com', 'correct-password');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stock balances' }),
    ).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/auth/login');
    expect(loginCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'admin@example.com', password: 'correct-password' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
    expect(screen.getByRole('button', { name: 'Profile menu for Admin User' })).toBeInTheDocument();
  });

  it('shows incorrect credentials without exposing a protected page', async () => {
    anonymousFetch(401, 'Invalid email or password');
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in to your account' });
    await fillLogin();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows the backend lockout message', async () => {
    anonymousFetch(401, 'Too many failed login attempts; try again later');
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Sign in to your account' });
    await fillLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed login attempts');
  });

  it('restores a refresh-cookie session and logs out through the backend', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody());
      if (url === '/api/v1/auth/me') return jsonResponse(200, { data: testUser(), meta: {} });
      if (url === '/api/v1/auth/logout') return new Response(null, { status: 204 });
      return jsonResponse(200, healthBody());
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Profile menu for Admin User' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your account' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('hides unauthorized navigation and denies a direct route', async () => {
    const storekeeper = testUser(
      ['inventory.balances.read', 'inventory.adjustments.request', 'inventory.transfers.post'],
      'Storekeeper',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(storekeeper));
        if (url === '/api/v1/auth/me') return jsonResponse(200, { data: storekeeper, meta: {} });
        return jsonResponse(200, healthBody());
      }),
    );
    renderRoute('/settings/users');

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Stock balances' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Adjustments' })).toBeInTheDocument();
    expect(within(nav).queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('heading', { name: 'Purchasing' })).not.toBeInTheDocument();
  });

  it('refreshes once after an access-token 401, then retries with the new token', async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(200, sessionBody(testUser(), `token-${refreshCount}`));
      }
      if (url === '/api/v1/auth/me') return jsonResponse(200, { data: testUser(), meta: {} });
      if (url === '/api/v1/inventory/balances') {
        return options?.headers &&
          (options.headers as Record<string, string>).Authorization === 'Bearer token-1'
          ? jsonResponse(401, {
              error: { code: 'UNAUTHENTICATED', message: 'Access token is invalid or expired' },
            })
          : jsonResponse(200, { data: 'recovered' });
      }
      return jsonResponse(200, healthBody());
    });
    vi.stubGlobal('fetch', fetchMock);

    function RequestProbe() {
      const { status, authorizedRequest } = useAuth();
      const [result, setResult] = useState('');
      if (status !== 'authenticated') return <p>Waiting for session</p>;
      return (
        <>
          <button
            onClick={() =>
              void authorizedRequest('/inventory/balances', z.object({ data: z.string() })).then(
                (body) => setResult(body.data),
              )
            }
          >
            Load balances
          </button>
          <p>{result}</p>
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <RequestProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Load balances' }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(refreshCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/inventory/balances',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-2' }),
      }),
    );
  });

  it('clears the signed-in state when both access and refresh sessions expire', async () => {
    let refreshCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/refresh') {
          refreshCount += 1;
          return refreshCount === 1
            ? jsonResponse(200, sessionBody())
            : jsonResponse(401, unauthenticated);
        }
        if (url === '/api/v1/auth/me') return jsonResponse(200, { data: testUser(), meta: {} });
        return jsonResponse(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Access token is invalid or expired' },
        });
      }),
    );

    function ExpiryProbe() {
      const { status, authorizedRequest } = useAuth();
      return (
        <>
          <p>Session: {status}</p>
          {status === 'authenticated' && (
            <button
              onClick={() =>
                void authorizedRequest('/inventory/balances', z.object({ data: z.string() })).catch(
                  () => undefined,
                )
              }
            >
              Load balances
            </button>
          )}
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <ExpiryProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Load balances' }));
    expect(await screen.findByText('Session: anonymous')).toBeInTheDocument();
    expect(refreshCount).toBe(2);
  });
});
