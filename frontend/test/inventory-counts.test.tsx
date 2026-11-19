import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const USER_ID = '111111111111111111111111';
const OTHER_ID = '222222222222222222222222';
const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const COUNT_ID = 'cccccccccccccccccccccccc';
const NOW = '2026-11-18T08:00:00.000Z';

function count(status: 'FROZEN' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' = 'FROZEN') {
  return {
    id: COUNT_ID,
    countNo: 'COUNT-0001',
    itemId: ITEM_ID,
    locationId: LOCATION_ID,
    item: { sku: 'CUE-001', name: 'Pool cue' },
    location: { code: 'WH', name: 'Warehouse' },
    status,
    bookQuantity: '2.5',
    bookValue: 12_500,
    bookVersion: 1,
    frozenAt: NOW,
    frozenBy: OTHER_ID,
    countedQuantity: status === 'FROZEN' ? null : '3',
    varianceQuantity: status === 'FROZEN' ? null : '0.5',
    inboundUnitCost: status === 'FROZEN' ? null : 5000,
    reason: status === 'FROZEN' ? null : 'Physical count',
    countedAt: status === 'FROZEN' ? null : NOW,
    countedBy: status === 'FROZEN' ? null : OTHER_ID,
    approvedAt: status === 'APPROVED' || status === 'POSTED' ? NOW : null,
    approvedBy: status === 'APPROVED' || status === 'POSTED' ? USER_ID : null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    postedAt: status === 'POSTED' ? NOW : null,
    postedBy: status === 'POSTED' ? USER_ID : null,
    movementIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function serialCount(status: 'FROZEN' | 'PENDING_APPROVAL' = 'FROZEN') {
  return {
    ...count(status),
    mode: 'SERIAL',
    bookQuantity: '2',
    bookSerialNumbers: ['ALPHA', 'BRAVO'],
    countedSerialNumbers: status === 'FROZEN' ? null : ['BRAVO', 'CHARLIE'],
  };
}

function mockCountApi(
  permissions: string[],
  initial: Array<ReturnType<typeof count> | ReturnType<typeof serialCount>> = [count()],
  listStatus = 200,
) {
  const user = { ...testUser(permissions), id: USER_ID };
  let records = initial;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.startsWith('/api/v1/inventory/counts?')) {
      if (listStatus !== 200)
        return jsonResponse(listStatus, {
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' },
        });
      return jsonResponse(200, { data: records, meta: {} });
    }
    if (url === '/api/v1/inventory/counts/options/items?q=')
      return jsonResponse(200, {
        data: [{ id: ITEM_ID, sku: 'CUE-001', name: 'Pool cue', baseUnit: 'PCS' }],
        meta: {},
      });
    if (url === '/api/v1/inventory/counts/options/locations?q=')
      return jsonResponse(200, {
        data: [{ id: LOCATION_ID, code: 'WH', name: 'Warehouse' }],
        meta: {},
      });
    if (url === '/api/v1/inventory/counts' && options?.method === 'POST') {
      records = [count()];
      return jsonResponse(201, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/counts/${COUNT_ID}/entry` && options?.method === 'PATCH') {
      records = [count('PENDING_APPROVAL')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (
      url === `/api/v1/inventory/counts/${COUNT_ID}/serial-entry` &&
      options?.method === 'PATCH'
    ) {
      records = [serialCount('PENDING_APPROVAL')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/counts/${COUNT_ID}/approve` && options?.method === 'POST') {
      records = [count('APPROVED')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/counts/${COUNT_ID}/post` && options?.method === 'POST') {
      records = [count('POSTED')];
      return jsonResponse(201, { data: records[0], meta: {} });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('stock count workflow', () => {
  it('denies readers without count permission before requesting count data', async () => {
    const fetchMock = mockCountApi(['dashboard.read']);
    renderRoute('/inventory/counts');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/counts'))).toBe(
      false,
    );
  });

  it('lets a Storekeeper enter a count but never offers approval or posting', async () => {
    const fetchMock = mockCountApi(['inventory.counts.read', 'inventory.counts.enter']);
    renderRoute('/inventory/counts');
    expect(await screen.findByText('COUNT-0001 · CUE-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post variance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Freeze book balance' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enter physical count' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Physical quantity' }), '3');
    await userEvent.type(screen.getByRole('spinbutton', { name: /Inbound unit cost/ }), '5000');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'Physical count');
    await userEvent.click(screen.getByRole('button', { name: 'Submit count' }));
    expect(await screen.findByText('Count submitted for approval.')).toBeInTheDocument();
    const entry = fetchMock.mock.calls.find(
      ([url]) => url === `/api/v1/inventory/counts/${COUNT_ID}/entry`,
    );
    expect(entry?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(entry?.[1]?.body))).toEqual({
      countedQuantity: '3',
      inboundUnitCost: 5000,
      reason: 'Physical count',
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('submits the physical serial set without using the numeric count endpoint', async () => {
    const fetchMock = mockCountApi(
      ['inventory.counts.read', 'inventory.counts.enter'],
      [serialCount()],
    );
    renderRoute('/inventory/counts');
    await screen.findByText('COUNT-0001 · CUE-001');
    await userEvent.click(screen.getByRole('button', { name: 'Enter physical count' }));
    const serials = screen.getByRole('textbox', { name: /Physical serial numbers/ });
    await userEvent.clear(serials);
    await userEvent.type(serials, 'BRAVO{enter}CHARLIE');
    await userEvent.type(screen.getByRole('spinbutton', { name: /Inbound unit cost/ }), '137');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'Physical serial check');
    await userEvent.click(screen.getByRole('button', { name: 'Submit count' }));
    expect(await screen.findByText('Serial count submitted for approval.')).toBeInTheDocument();
    const serialEntry = fetchMock.mock.calls.find(
      ([url]) => url === `/api/v1/inventory/counts/${COUNT_ID}/serial-entry`,
    );
    expect(JSON.parse(String(serialEntry?.[1]?.body))).toEqual({
      serialNumbers: ['BRAVO', 'CHARLIE'],
      inboundUnitCost: 137,
      reason: 'Physical serial check',
    });
    expect(
      fetchMock.mock.calls.some(([url]) => url === `/api/v1/inventory/counts/${COUNT_ID}/entry`),
    ).toBe(false);
  });

  it('shows an entered empty serial set as none', async () => {
    mockCountApi(
      ['inventory.counts.read'],
      [
        {
          ...serialCount('PENDING_APPROVAL'),
          bookQuantity: '0',
          bookSerialNumbers: [],
          countedQuantity: '0',
          countedSerialNumbers: [],
          varianceQuantity: '0',
          inboundUnitCost: null,
        },
      ],
    );
    renderRoute('/inventory/counts');
    await screen.findByText('COUNT-0001 · CUE-001');
    await userEvent.click(screen.getByText('Serial count detail'));
    expect(screen.getByText('Counted: none')).toBeInTheDocument();
  });

  it('lets a separate authorised manager approve and then post', async () => {
    const fetchMock = mockCountApi(
      ['inventory.counts.read', 'inventory.counts.approve', 'inventory.counts.post'],
      [count('PENDING_APPROVAL')],
    );
    renderRoute('/inventory/counts');
    await screen.findByText('COUNT-0001 · CUE-001');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Count approved.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Post variance' }));
    expect(await screen.findByText('Count variance posted.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/post'))).toHaveLength(1);
  });

  it('can freeze an active item and location even without an existing balance', async () => {
    const fetchMock = mockCountApi(['inventory.counts.read', 'inventory.counts.freeze'], []);
    renderRoute('/inventory/counts');
    expect(await screen.findByText('No stock counts match this status.')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'CUE-001 — Pool cue' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), ITEM_ID);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Freeze book balance' }));
    expect(await screen.findByText('Book balance frozen for counting.')).toBeInTheDocument();
    const freeze = fetchMock.mock.calls.find(([url]) => url === '/api/v1/inventory/counts');
    expect(JSON.parse(String(freeze?.[1]?.body))).toEqual({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
    });
  });

  it('shows a retry state when the count list fails', async () => {
    mockCountApi(['inventory.counts.read'], [], 503);
    renderRoute('/inventory/counts');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load stock counts'),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
