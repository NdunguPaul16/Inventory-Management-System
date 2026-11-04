import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { HealthResponse } from '@ims/shared';
import { routes } from '../src/app/routes';

export function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
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

/** Stubs `fetch` so every call returns `body` with `status`. */
export function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
