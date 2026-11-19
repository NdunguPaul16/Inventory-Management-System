import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ITEM_URL = `/inventory/items/${ITEM_ID}/stock?locationId=${LOCATION_ID}`;
const BALANCES_PATH = `/api/v1/inventory/balances?limit=20&itemId=${ITEM_ID}`;
const LAYERS_PATH = `/api/v1/inventory/items/${ITEM_ID}/layers?locationId=${LOCATION_ID}`;
const MOVEMENTS_PATH = `/api/v1/inventory/items/${ITEM_ID}/movements?locationId=${LOCATION_ID}&limit=50`;

function mockDetailApi(permissions: string[], firstMovementPageSize = 1) {
  const user = testUser(permissions);
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url === BALANCES_PATH)
      return jsonResponse(200, {
        data: [
          {
            _id: 'cccccccccccccccccccccccc',
            itemId: {
              _id: ITEM_ID,
              sku: 'CUE-001',
              name: 'Pool cue',
              type: 'TRADING_GOOD',
              baseUnit: 'PCS',
            },
            locationId: { _id: LOCATION_ID, code: 'WH', name: 'Warehouse', type: 'WAREHOUSE' },
            onHand: { $numberDecimal: '2.5' },
            reserved: { $numberDecimal: '0' },
            value: 12_500,
            version: 1,
          },
        ],
        meta: {},
      });
    if (url === LAYERS_PATH)
      return jsonResponse(200, {
        data: [
          {
            _id: 'dddddddddddddddddddddddd',
            receivedAt: '2026-11-18T08:00:00.000Z',
            originalQty: { $numberDecimal: '2.5' },
            remainingQty: { $numberDecimal: '2.5' },
            originalValue: 12_500,
            remainingValue: 12_500,
            unitCost: 5000,
            sourceDoc: { type: 'TEST', id: 'receipt-1', number: 'TEST-1' },
          },
          {
            _id: 'ffffffffffffffffffffffff',
            receivedAt: '2026-11-01T08:00:00.000Z',
            originalQty: { $numberDecimal: '1' },
            remainingQty: { $numberDecimal: '0' },
            unitCost: 5000,
            sourceDoc: { type: 'TEST', id: 'receipt-old', number: 'TEST-OLD' },
          },
        ],
        meta: {},
      });
    if (url.startsWith(MOVEMENTS_PATH))
      return jsonResponse(200, {
        data: Array.from(
          { length: url === MOVEMENTS_PATH ? firstMovementPageSize : 1 },
          (_, index) => ({
            _id: String(url === MOVEMENTS_PATH ? 100 - index : 1).padStart(24, '0'),
            movementNo: url === MOVEMENTS_PATH ? `STK-${index + 1}` : 'STK-OLDER',
            direction: 'IN',
            quantity: { $numberDecimal: '2.5' },
            movementType: 'OPENING',
            totalCost: 12_500,
            sourceDoc: { type: 'TEST', id: 'receipt-1', number: 'TEST-1' },
            postedAt: '2026-11-18T08:00:00.000Z',
          }),
        ),
        meta: {},
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('item stock detail', () => {
  it('loads FIFO layers and movements only when their permitted tab is opened', async () => {
    const fetchMock = mockDetailApi([
      'inventory.balances.read',
      'inventory.layers.read',
      'inventory.movements.read',
    ]);
    renderRoute(ITEM_URL);
    expect(await screen.findByRole('heading', { name: 'CUE-001 — Pool cue' })).toBeInTheDocument();
    expect(screen.getByText('2.5 PCS')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url === LAYERS_PATH || url === MOVEMENTS_PATH),
    ).toBe(false);

    await userEvent.click(screen.getByRole('tab', { name: 'FIFO layers' }));
    expect(await screen.findByText('TEST-1')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === LAYERS_PATH)).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === MOVEMENTS_PATH)).toBe(false);

    await userEvent.click(screen.getByRole('tab', { name: 'Movements' }));
    expect(await screen.findByText(/STK-1/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === MOVEMENTS_PATH)).toBe(true);
  });

  it('hides unauthorized tabs and never requests their data', async () => {
    const fetchMock = mockDetailApi(['inventory.balances.read']);
    renderRoute(ITEM_URL);
    expect(await screen.findByRole('heading', { name: 'CUE-001 — Pool cue' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'FIFO layers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Movements' })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url === LAYERS_PATH || url === MOVEMENTS_PATH),
    ).toBe(false);
  });

  it('uses the last movement id as a cursor to load earlier history', async () => {
    const fetchMock = mockDetailApi(['inventory.balances.read', 'inventory.movements.read'], 50);
    renderRoute(ITEM_URL);
    await screen.findByRole('heading', { name: 'CUE-001 — Pool cue' });
    await userEvent.click(screen.getByRole('tab', { name: 'Movements' }));
    await screen.findByText(/STK-50/);
    await userEvent.click(screen.getByRole('button', { name: 'Load earlier movements' }));
    expect(await screen.findByText(/STK-OLDER/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === `${MOVEMENTS_PATH}&before=${String(51).padStart(24, '0')}`,
      ),
    ).toBe(true);
  });
});
