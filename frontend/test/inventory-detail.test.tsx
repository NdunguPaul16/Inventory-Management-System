import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SECOND_LOCATION_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';
const ITEM_URL = `/inventory/items/${ITEM_ID}/stock?locationId=${LOCATION_ID}`;
const BALANCES_PATH = `/api/v1/inventory/balances?limit=20&itemId=${ITEM_ID}`;
const LAYERS_PATH = `/api/v1/inventory/items/${ITEM_ID}/layers?locationId=${LOCATION_ID}&limit=50`;
const MOVEMENTS_PATH = `/api/v1/inventory/items/${ITEM_ID}/movements?locationId=${LOCATION_ID}&limit=50`;

function mockDetailApi(
  permissions: string[],
  firstMovementPageSize = 1,
  firstLayerPageSize = 2,
  firstBalancePageSize = 1,
) {
  const user = testUser(permissions);
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.startsWith(BALANCES_PATH))
      return jsonResponse(200, {
        data: Array.from(
          { length: url === BALANCES_PATH ? firstBalancePageSize : 1 },
          (_, index) => ({
            _id: String(url === BALANCES_PATH ? index + 1 : 21).padStart(24, '0'),
            itemId: {
              _id: ITEM_ID,
              sku: 'CUE-001',
              name: 'Pool cue',
              type: 'TRADING_GOOD',
              baseUnit: 'PCS',
            },
            locationId: {
              _id:
                url === BALANCES_PATH && index === 0
                  ? LOCATION_ID
                  : url === BALANCES_PATH
                    ? String(index + 1).padStart(24, '0')
                    : SECOND_LOCATION_ID,
              code: url === BALANCES_PATH ? `WH-${index + 1}` : 'WH-21',
              name: url === BALANCES_PATH ? `Warehouse ${index + 1}` : 'Warehouse 21',
              type: 'WAREHOUSE',
            },
            onHand: { $numberDecimal: '2.5' },
            reserved: { $numberDecimal: '0' },
            value: 12_500,
            version: 1,
          }),
        ),
        meta: {},
      });
    if (url.startsWith(`/api/v1/inventory/items/${ITEM_ID}/layers?`))
      return jsonResponse(200, {
        data: Array.from({ length: url === LAYERS_PATH ? firstLayerPageSize : 1 }, (_, index) => ({
          _id: String(url === LAYERS_PATH ? index + 1 : 51).padStart(24, '0'),
          receivedAt: '2026-11-18T08:00:00.000Z',
          originalQty: { $numberDecimal: '2.5' },
          remainingQty: { $numberDecimal: '2.5' },
          originalValue: 12_500,
          remainingValue: 12_500,
          unitCost: 5000,
          sourceDoc: {
            type: 'TEST',
            id: `receipt-${index + 1}`,
            number: url === LAYERS_PATH ? `TEST-${index + 1}` : 'TEST-LATER',
          },
        })),
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
    expect(screen.getByText('TEST-2')).toBeInTheDocument();
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

  it('loads a second FIFO layer page only after an explicit click', async () => {
    const fetchMock = mockDetailApi(['inventory.balances.read', 'inventory.layers.read'], 1, 50);
    renderRoute(ITEM_URL);
    await screen.findByRole('heading', { name: /CUE-001.*Pool cue/ });
    await userEvent.click(screen.getByRole('tab', { name: 'FIFO layers' }));
    await screen.findByText('TEST-50');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('&before='))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Load later FIFO layers' }));
    expect(await screen.findByText('TEST-LATER')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === `${LAYERS_PATH}&before=${String(50).padStart(24, '0')}`,
      ),
    ).toBe(true);
  });

  it('offers later stock locations while viewing FIFO layers', async () => {
    const fetchMock = mockDetailApi(['inventory.balances.read', 'inventory.layers.read'], 1, 2, 20);
    renderRoute(ITEM_URL);
    await screen.findByRole('heading', { name: /CUE-001.*Pool cue/ });
    await userEvent.click(screen.getByRole('tab', { name: 'FIFO layers' }));
    await screen.findByText('TEST-1');
    await userEvent.click(screen.getByRole('button', { name: 'Load more locations' }));
    expect(await screen.findByRole('option', { name: 'WH-21 — Warehouse 21' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Location'), SECOND_LOCATION_ID);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        url.startsWith(
          `/api/v1/inventory/items/${ITEM_ID}/layers?locationId=${SECOND_LOCATION_ID}`,
        ),
      ),
    ).toBe(true);
  });
});
