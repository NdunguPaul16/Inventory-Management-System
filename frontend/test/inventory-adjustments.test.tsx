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
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'POSTED' = 'PENDING_APPROVAL',
  requestedBy = OTHER_ID,
) {
  return {
    id: ACTION_ID,
    actionNo: 'STKACT-0001',
    actionType: 'ADJUSTMENT',
    status,
    payload: {
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1',
      direction: 'IN',
      unitCost: 500,
      reason: 'Count correction',
      sourceDoc: { type: 'ADJUSTMENT_REQUEST', id: 'request-id', number: 'ADJ-1' },
    },
    requestedBy,
    approvedBy: status === 'APPROVED' || status === 'POSTED' ? USER_ID : null,
    approvedAt: status === 'APPROVED' || status === 'POSTED' ? NOW : null,
    rejectedBy: status === 'REJECTED' ? USER_ID : null,
    rejectedAt: status === 'REJECTED' ? NOW : null,
    rejectionReason: status === 'REJECTED' ? 'Check again' : null,
    postedBy: status === 'POSTED' ? USER_ID : null,
    postedAt: status === 'POSTED' ? NOW : null,
    movementIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mockAdjustmentApi(
  permissions: string[],
  initial = [action()],
  firstRequestFails = false,
  customApprover = false,
) {
  const user = { ...testUser(permissions), id: USER_ID };
  if (permissions.some((permission) => permission.endsWith('.approve'))) {
    user.roles = user.roles.map((role) => ({
      ...role,
      name: customApprover ? 'Custom Approver' : 'Owner / Manager',
      isSystem: !customApprover,
    }));
  }
  let records = initial;
  let creates = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
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
    if (url === '/api/v1/inventory/adjustments' && options?.method === 'POST') {
      creates += 1;
      if (firstRequestFails && creates === 1) throw new TypeError('Network connection lost');
      records = [action('PENDING_APPROVAL', USER_ID)];
      return jsonResponse(201, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/approve`) {
      records = [action('APPROVED')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/post`) {
      records = [action('POSTED')];
      return jsonResponse(201, {
        data: {
          request: records[0],
          posting: { movementIds: ['333333333333333333333333'], replayed: false },
        },
        meta: {},
      });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/reject`) {
      records = [action('REJECTED')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'request-uuid' });
  return fetchMock;
}

describe('stock adjustments page', () => {
  it('denies a user without request-history permission before inventory calls', async () => {
    const fetchMock = mockAdjustmentApi(['dashboard.read']);
    renderRoute('/inventory/adjustments');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/'))).toBe(false);
  });

  it('lets a Storekeeper submit a request without approval or posting actions', async () => {
    const fetchMock = mockAdjustmentApi(
      ['inventory.requests.read', 'inventory.adjustments.request'],
      [],
    );
    renderRoute('/inventory/adjustments');
    await screen.findByRole('option', { name: 'CUE-1 — Cue' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), ITEM_ID);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_ID);
    await userEvent.type(screen.getByRole('textbox', { name: /Quantity in/ }), '1');
    await userEvent.type(
      screen.getByRole('spinbutton', { name: 'Inbound unit cost (cents)' }),
      '500',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Reference' }), 'ADJ-1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'Count correction');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(
      await screen.findByText('Adjustment request STKACT-0001 submitted for approval.'),
    ).toBeInTheDocument();
    const create = fetchMock.mock.calls.find(([url]) => url === '/api/v1/inventory/adjustments');
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      direction: 'IN',
      unitCost: 500,
      sourceDoc: { type: 'ADJUSTMENT_REQUEST', id: 'request-uuid', number: 'ADJ-1' },
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post adjustment' })).not.toBeInTheDocument();
  });

  it('allows a request-only role without fetching restricted request history', async () => {
    const fetchMock = mockAdjustmentApi(['inventory.adjustments.request'], []);
    renderRoute('/inventory/adjustments');
    expect(await screen.findByRole('heading', { name: 'Stock adjustments' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Submit request' })).toBeInTheDocument();
    expect(screen.queryByText('Adjustment requests')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url.startsWith('/api/v1/inventory/requests?')),
    ).toBe(false);
  });

  it('shows a separate manager approval and posting path', async () => {
    const fetchMock = mockAdjustmentApi([
      'inventory.requests.read',
      'inventory.adjustments.approve',
      'inventory.adjustments.post',
    ]);
    renderRoute('/inventory/adjustments');
    await screen.findByText(/STKACT-0001/);
    expect(screen.queryByRole('button', { name: 'Submit request' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Adjustment approved.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Post adjustment' }));
    expect(await screen.findByText('Adjustment posted.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/post'))).toHaveLength(1);
  });

  it.each([
    ['PENDING_APPROVAL', 'Approve'],
    ['APPROVED', 'Post adjustment'],
  ] as const)(
    'hides %s actions from a custom role with approval permissions',
    async (status, button) => {
      mockAdjustmentApi(
        ['inventory.requests.read', 'inventory.adjustments.approve', 'inventory.adjustments.post'],
        [action(status)],
        false,
        true,
      );
      renderRoute('/inventory/adjustments');
      await screen.findByText(/STKACT-0001/);
      expect(screen.queryByRole('button', { name: button })).not.toBeInTheDocument();
    },
  );

  it('hides approval from the requester and allows rejection with a reason', async () => {
    const fetchMock = mockAdjustmentApi(
      ['inventory.requests.read', 'inventory.adjustments.approve'],
      [action('PENDING_APPROVAL', USER_ID)],
    );
    renderRoute('/inventory/adjustments');
    await screen.findByText(/STKACT-0001/);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Rejection reason' }), 'Check again');
    await userEvent.click(screen.getByRole('button', { name: 'Reject adjustment' }));
    expect(await screen.findByText('Adjustment rejected.')).toBeInTheDocument();
    const rejection = fetchMock.mock.calls.find(([url]) => url.endsWith('/reject'));
    expect(JSON.parse(String(rejection?.[1]?.body))).toEqual({ reason: 'Check again' });
  });

  it('does not automatically repeat an uncertain creation request', async () => {
    const fetchMock = mockAdjustmentApi(
      ['inventory.requests.read', 'inventory.adjustments.request'],
      [],
      true,
    );
    renderRoute('/inventory/adjustments');
    await screen.findByRole('option', { name: 'CUE-1 — Cue' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Item' }), ITEM_ID);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Location' }), LOCATION_ID);
    await userEvent.type(screen.getByRole('textbox', { name: /Quantity in/ }), '1');
    await userEvent.type(
      screen.getByRole('spinbutton', { name: 'Inbound unit cost (cents)' }),
      '500',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Reference' }), 'ADJ-1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'Count correction');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('result is uncertain');
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/adjustments'),
    ).toHaveLength(1);
  });
});
