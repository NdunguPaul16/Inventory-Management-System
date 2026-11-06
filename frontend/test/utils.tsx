import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { AuthUser, HealthResponse } from '@ims/shared';
import { routes } from '../src/app/routes';
import { AuthProvider } from '../src/modules/auth/AuthProvider';

export function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

export function healthBody(overrides: Partial<HealthResponse['data']> = {}): HealthResponse {
  return {
    data: {
      status: 'ok',
      app: { name: '@ims/server', version: '0.1.0', environment: 'test', uptimeSeconds: 125 },
      db: { status: 'up', state: 'connected', latencyMs: 3 },
      time: '2026-10-01T07:00:00.000Z',
      ...overrides,
    },
    meta: {},
  };
}

export function testUser(permissions: string[] = ['*'], name = 'Admin User'): AuthUser {
  return {
    id: 'user-1',
    name,
    email: 'admin@example.com',
    roles: [
      {
        id: 'role-1',
        name: permissions.includes('*') ? 'Admin' : 'Staff',
        description: null,
        permissions,
        isSystem: true,
      },
    ],
    permissions,
  };
}

export function sessionBody(user: AuthUser = testUser(), accessToken = 'access-token') {
  return { data: { user, accessToken }, meta: {} };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Auth endpoints return a valid session; `status` and `body` describe the health request. */
export function mockFetch(status: number, body: unknown, healthError?: Error) {
  const fn = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody());
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: testUser(), meta: {} });
    if (healthError) throw healthError;
    return jsonResponse(status, body);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
