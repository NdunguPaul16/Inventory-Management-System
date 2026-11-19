import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const USER_ID = '111111111111111111111111';
const OTHER_ID = '222222222222222222222222';
const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACTION_ID = 'cccccccccccccccccccccccc';
const NOW = '2026-11-18T08:00:00.000Z';

function action(
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' = 'PENDING_APPROVAL',
  requestedBy = OTHER_ID,
) {
  return {
    id: ACTION_ID,
    actionNo: 'STKACT-0001',
    actionType: 'OPENING',
    status,
    payload: {
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2',
      unitCost: 500,
      sourceDoc: { type: 'OPENING_STOCK_ENTRY', id: 'request-uuid', number: 'OB-1' },
      receivedAt: NOW,
    },
    requestedBy,
    approvedBy: status === 'APPROVED' || status === 'POSTED' ? USER_ID : null,
    rejectionReason: null,
    createdAt: NOW,
  };
}

function mockApi(permissions: string[], initial = [action()], failCreate = false) {
  const user = { ...testUser(permissions), id: USER_ID };
  let records = initial;
  let creates = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.includes('actionType=OPENING_BATCH')) return jsonResponse(200, { data: [], meta: {} });
    if (url.startsWith('/api/v1/inventory/requests?'))
      return jsonResponse(200, { data: records, meta: {} });
    if (url === '/api/v1/inventory/options/items?q=')
      return jsonResponse(200, {
        data: [{ id: ITEM_ID, sku: 'CUE-1', name: 'Cue', baseUnit: 'PCS', trackSerial: false }],
        meta: {},
      });
    if (url === '/api/v1/inventory/options/locations?q=')
      return jsonResponse(200, {
        data: [{ id: LOCATION_ID, code: 'WH', name: 'Warehouse' }],
        meta: {},
      });
    if (url === '/api/v1/inventory/opening-stock' && options?.method === 'POST') {
      creates += 1;
      if (failCreate && creates === 1) throw new TypeError('Network lost');
      records = [action('PENDING_APPROVAL', USER_ID)];
      return jsonResponse(201, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/approve`) {
      records = [action('APPROVED', USER_ID)];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/post`) {
      records = [action('POSTED', USER_ID)];
      return jsonResponse(201, { data: { request: records[0], posting: {} }, meta: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'request-uuid' });
  return fetchMock;
}

describe('opening stock page', () => {
  it('denies an unrelated role before inventory requests', async () => {
    const fetchMock = mockApi(['dashboard.read']);
    renderRoute('/inventory/opening-stock');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/'))).toBe(false);
  });

  it('submits a validated opening request with the chosen FIFO receipt date', async () => {
    const fetchMock = mockApi(['inventory.opening.request'], []);
    renderRoute('/inventory/opening-stock');
    await screen.findByRole('option', { name: 'CUE-1 — Cue' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), ITEM_ID);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_ID);
    await userEvent.type(screen.getByRole('textbox', { name: /Quantity in/ }), '2');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Unit cost (cents)' }), '500');
    await userEvent.type(screen.getByRole('textbox', { name: 'Source reference' }), 'OB-1');
    await userEvent.type(screen.getByLabelText('Receipt date (optional, UTC)'), '2026-11-18');
    await userEvent.click(screen.getByRole('button', { name: 'Submit opening request' }));
    expect(
      await screen.findByText('Opening-stock request STKACT-0001 submitted for approval.'),
    ).toBeInTheDocument();
    const create = fetchMock.mock.calls.find(([url]) => url === '/api/v1/inventory/opening-stock');
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2',
      unitCost: 500,
      receivedAt: '2026-11-18T00:00:00.000Z',
      sourceDoc: { type: 'OPENING_STOCK_ENTRY', number: 'OB-1' },
    });
    expect(
      fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/requests?')),
    ).toBe(false);
  });

  it('lets an Admin approve and post initial opening stock through existing actions', async () => {
    const fetchMock = mockApi(['*'], [action('PENDING_APPROVAL', USER_ID)]);
    renderRoute('/inventory/opening-stock');
    await screen.findByText(/STKACT-0001/);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Opening-stock request approved.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Post opening stock' }));
    expect(await screen.findByText('Opening stock posted.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/post'))).toHaveLength(1);
  });

  it('blocks resubmission after an uncertain creation outcome', async () => {
    const fetchMock = mockApi(['inventory.opening.request'], [], true);
    renderRoute('/inventory/opening-stock');
    await screen.findByRole('option', { name: 'CUE-1 — Cue' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), ITEM_ID);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_ID);
    await userEvent.type(screen.getByRole('textbox', { name: /Quantity in/ }), '2');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Unit cost (cents)' }), '500');
    await userEvent.type(screen.getByRole('textbox', { name: 'Source reference' }), 'OB-1');
    await userEvent.click(screen.getByRole('button', { name: 'Submit opening request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('result is uncertain');
    expect(screen.getByRole('button', { name: 'Submit opening request' })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/opening-stock'),
    ).toHaveLength(1);
  });
});
