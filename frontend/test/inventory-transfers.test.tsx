import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SERIAL_ITEM_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SOURCE_ID = 'cccccccccccccccccccccccc';
const DEST_ID = 'dddddddddddddddddddddddd';

function mockTransferApi(permissions: string[], firstPostFails = false) {
  const user = testUser(permissions);
  let posts = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url === '/api/v1/inventory/options/items?q=')
      return jsonResponse(200, {
        data: [
          { id: ITEM_ID, sku: 'CUE-1', name: 'Cue', baseUnit: 'PCS', trackSerial: false },
          {
            id: SERIAL_ITEM_ID,
            sku: 'MACHINE-1',
            name: 'Machine',
            baseUnit: 'PCS',
            trackSerial: true,
          },
        ],
        meta: {},
      });
    if (url === '/api/v1/inventory/options/locations?q=')
      return jsonResponse(200, {
        data: [
          { id: SOURCE_ID, code: 'WH', name: 'Warehouse' },
          { id: DEST_ID, code: 'SHOP', name: 'Showroom' },
        ],
        meta: {},
      });
    if (url === '/api/v1/inventory/transfers' && options?.method === 'POST') {
      posts += 1;
      if (firstPostFails && posts === 1) throw new TypeError('Network connection lost');
      return jsonResponse(201, {
        data: {
          movementIds: ['111111111111111111111111', '222222222222222222222222'],
          movements: [
            {
              id: '111111111111111111111111',
              movementNo: 'STK-1',
              direction: 'OUT',
              quantity: '1',
              totalCost: 500,
            },
            {
              id: '222222222222222222222222',
              movementNo: 'STK-2',
              direction: 'IN',
              quantity: '1',
              totalCost: 500,
            },
          ],
          replayed: posts > 1,
        },
        meta: {},
      });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'transfer-test-uuid' });
  return fetchMock;
}

async function selectReferences(itemId = ITEM_ID) {
  await screen.findByRole('option', { name: 'CUE-1 — Cue' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), itemId);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'From location' }), SOURCE_ID);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'To location' }), DEST_ID);
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity in/ }), '1');
  await userEvent.type(screen.getByRole('textbox', { name: 'Transfer reference' }), 'MOVE-1');
}

describe('stock transfer page', () => {
  it('blocks users without transfer permission before reference or posting requests', async () => {
    const fetchMock = mockTransferApi(['inventory.balances.read']);
    renderRoute('/inventory/transfers');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/'))).toBe(false);
  });

  it('posts one serial transfer with the required idempotency key', async () => {
    const fetchMock = mockTransferApi(['inventory.transfers.post']);
    renderRoute('/inventory/transfers');
    await selectReferences(SERIAL_ITEM_ID);
    await userEvent.type(screen.getByRole('textbox', { name: /Serial numbers/ }), 'SERIAL-001');
    await userEvent.click(screen.getByRole('button', { name: 'Post transfer' }));
    expect(await screen.findByText('Transfer posted: STK-1, STK-2.')).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/transfers');
    expect(posts).toHaveLength(1);
    expect((posts[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'transfer-test-uuid',
    );
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
      itemId: SERIAL_ITEM_ID,
      fromLocationId: SOURCE_ID,
      toLocationId: DEST_ID,
      quantity: '1',
      serialNumbers: ['SERIAL-001'],
      sourceDoc: { type: 'STOCK_TRANSFER', id: 'transfer-test-uuid', number: 'MOVE-1' },
    });
  });

  it('retries an uncertain result with the same key and blocks changed details', async () => {
    const fetchMock = mockTransferApi(['inventory.transfers.post'], true);
    renderRoute('/inventory/transfers');
    await selectReferences();
    await userEvent.click(screen.getByRole('button', { name: 'Post transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network connection lost');
    await userEvent.type(screen.getByRole('textbox', { name: 'Transfer reference' }), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Post transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'previous transfer result is uncertain',
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/transfers'),
    ).toHaveLength(1);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Transfer reference' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Transfer reference' }), 'MOVE-1');
    await userEvent.click(screen.getByRole('button', { name: 'Post transfer' }));
    expect(
      await screen.findByText('The existing transfer was found; no duplicate was posted.'),
    ).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/transfers');
    expect(posts).toHaveLength(2);
    expect((posts[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (posts[1]?.[1]?.headers as Record<string, string>)['Idempotency-Key'],
    );
  });

  it('rejects a same-location transfer locally', async () => {
    const fetchMock = mockTransferApi(['inventory.transfers.post']);
    renderRoute('/inventory/transfers');
    await selectReferences();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'To location' }), SOURCE_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Post transfer' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('different source and destination'),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/transfers'),
    ).toHaveLength(0);
  });
});
