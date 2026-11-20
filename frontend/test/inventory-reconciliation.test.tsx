import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const itemId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const locationId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function mockApi(
  permissions: string[],
  result: { checked: number; differences: unknown[] } | null = { checked: 1, differences: [] },
) {
  const user = testUser(permissions);
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url === '/api/v1/inventory/reconciliation') {
      return result
        ? jsonResponse(200, { data: result, meta: {} })
        : jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' } });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function reconciliationCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/reconciliation');
}

describe('stock reconciliation page', () => {
  it('runs only after an explicit click and reports a clean ledger', async () => {
    const fetchMock = mockApi(['inventory.reconciliation.read']);
    renderRoute('/inventory/reconciliation');
    expect(await screen.findByRole('button', { name: 'Run reconciliation' })).toBeInTheDocument();
    expect(reconciliationCalls(fetchMock)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));
    expect(await screen.findByText('No differences found.')).toBeInTheDocument();
    expect(reconciliationCalls(fetchMock)).toHaveLength(1);
  });

  it('shows each ledger, layer and balance value when a difference is found', async () => {
    const fetchMock = mockApi(['*'], {
      checked: 1,
      differences: [
        {
          itemId,
          locationId,
          balanceQty: '2',
          ledgerQty: '1',
          layerQty: '1',
          balanceValue: 200,
          ledgerValue: 100,
          layerValue: 100,
        },
      ],
    });
    renderRoute('/inventory/reconciliation');
    await userEvent.click(await screen.findByRole('button', { name: 'Run reconciliation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 stock difference found');
    expect(screen.getByRole('link', { name: `${itemId} / ${locationId}` })).toHaveAttribute(
      'href',
      `/inventory/items/${itemId}/stock?locationId=${locationId}`,
    );
    expect(reconciliationCalls(fetchMock)).toHaveLength(1);
  });

  it('denies users without reconciliation permission and does not call its API', async () => {
    const fetchMock = mockApi(['inventory.balances.read']);
    renderRoute('/inventory/reconciliation');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(reconciliationCalls(fetchMock)).toHaveLength(0);
  });

  it('shows a safe error without keeping a stale result after failure', async () => {
    const fetchMock = mockApi(['inventory.reconciliation.read'], null);
    renderRoute('/inventory/reconciliation');
    await userEvent.click(await screen.findByRole('button', { name: 'Run reconciliation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be completed');
    expect(reconciliationCalls(fetchMock)).toHaveLength(1);
  });
});
