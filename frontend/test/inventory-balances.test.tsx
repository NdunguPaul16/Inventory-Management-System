import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ITEM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const LOCATION_A = 'cccccccccccccccccccccccc';
const LOCATION_B = 'dddddddddddddddddddddddd';

const records = [
  {
    _id: '111111111111111111111111',
    itemId: {
      _id: ITEM_A,
      sku: 'CUE-001',
      name: 'Pool cue',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    },
    locationId: { _id: LOCATION_A, code: 'WH', name: 'Warehouse', type: 'WAREHOUSE' },
    onHand: { $numberDecimal: '2.5' },
    reserved: { $numberDecimal: '0' },
    value: 12550,
    version: 1,
    lastMovementAt: '2026-11-18T08:00:00.000Z',
  },
  {
    _id: '222222222222222222222222',
    itemId: {
      _id: ITEM_B,
      sku: 'BALL-002',
      name: 'Pool ball',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    },
    locationId: { _id: LOCATION_B, code: 'SHOP', name: 'Showroom', type: 'SHOWROOM' },
    onHand: { $numberDecimal: '3' },
    reserved: { $numberDecimal: '1' },
    value: 4800,
    version: 2,
  },
];

function mockBalancesApi(permissions = ['inventory.balances.read'], balanceStatus = 200) {
  const user = testUser(permissions);
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url === '/api/v1/inventory/balances') {
      return balanceStatus === 200
        ? jsonResponse(200, { data: records, meta: {} })
        : jsonResponse(balanceStatus, {
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' },
          });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('stock balances page', () => {
  it('shows quantities and FIFO values and filters by item and location', async () => {
    const fetchMock = mockBalancesApi();
    renderRoute('/inventory/balances');
    expect(await screen.findByText('CUE-001')).toBeInTheDocument();
    expect(screen.getByText('BALL-002')).toBeInTheDocument();
    expect(screen.getByText('2.5 PCS')).toBeInTheDocument();
    expect(screen.getByText(/Ksh\s*125\.50/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stock' }), 'cue');
    expect(screen.queryByText('BALL-002')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search stock' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_B);
    expect(screen.queryByText('CUE-001')).not.toBeInTheDocument();
    expect(screen.getByText('BALL-002')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/balances'),
    ).toHaveLength(1);
  });

  it('does not request balances for a user without permission', async () => {
    const fetchMock = mockBalancesApi(['dashboard.read']);
    renderRoute('/inventory/balances');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/inventory/balances')).toBe(false);
  });

  it('offers a retry when the balance request fails', async () => {
    mockBalancesApi(['inventory.balances.read'], 503);
    renderRoute('/inventory/balances');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load stock balances');
  });
});
