import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, mockFetch, renderRoute } from './utils';

describe('SystemStatusPage', () => {
  it('calls the health endpoint and shows API and database status', async () => {
    const fetchMock = mockFetch(200, healthBody());
    renderRoute('/system/status');

    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByText('3 ms')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('shows a degraded API and a down database from a 503 response', async () => {
    mockFetch(
      503,
      healthBody({
        status: 'degraded',
        db: { status: 'down', state: 'disconnected', latencyMs: null },
      }),
    );
    renderRoute('/system/status');

    expect(await screen.findByRole('heading', { level: 2, name: 'API' })).toBeInTheDocument();
    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('shows the API as unreachable when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderRoute('/system/status');

    expect(await screen.findByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.getByText('API offline')).toBeInTheDocument();
  });

  it('surfaces the error envelope message for other failures', async () => {
    mockFetch(500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    renderRoute('/system/status');

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
});
