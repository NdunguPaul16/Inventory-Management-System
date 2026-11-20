import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const USER_ID = '111111111111111111111111';
const ITEM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LOCATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACTION_ID = 'cccccccccccccccccccccccc';
const NOW = '2026-11-18T08:00:00.000Z';

function batch(status: 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED') {
  return {
    id: ACTION_ID,
    actionNo: 'STKACT-0002',
    actionType: 'OPENING_BATCH',
    status,
    payload: {
      sourceDoc: { type: 'OPENING_IMPORT', id: 'sheet-uuid', number: 'INITIAL-2' },
      lines: [
        {
          lineId: 'row-2',
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          sku: 'CUE-1',
          locationCode: 'WH',
          quantity: '0.5',
          unitCost: 101,
        },
      ],
    },
    requestedBy: USER_ID,
    approvedBy: status === 'PENDING_APPROVAL' ? null : USER_ID,
    rejectionReason: null,
    createdAt: NOW,
  };
}

function mockApi(permissions: string[]) {
  const user = { ...testUser(permissions), id: USER_ID };
  let records: ReturnType<typeof batch>[] = [];
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.includes('actionType=OPENING_BATCH'))
      return jsonResponse(200, { data: records, meta: {} });
    if (url.startsWith('/api/v1/inventory/requests?'))
      return jsonResponse(200, { data: [], meta: {} });
    if (url.startsWith('/api/v1/inventory/options/'))
      return jsonResponse(200, { data: [], meta: {} });
    if (url === '/api/v1/inventory/opening-stock/imports' && options?.method === 'POST') {
      records = [batch('PENDING_APPROVAL')];
      return jsonResponse(201, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/approve`) {
      records = [batch('APPROVED')];
      return jsonResponse(200, { data: records[0], meta: {} });
    }
    if (url === `/api/v1/inventory/requests/${ACTION_ID}/post`) {
      records = [batch('POSTED')];
      return jsonResponse(201, { data: { request: records[0] }, meta: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'sheet-uuid' });
  return fetchMock;
}

describe('opening-stock import wizard', () => {
  it('previews a CSV before one explicit request, then supports approval and posting', async () => {
    const fetchMock = mockApi(['*']);
    renderRoute('/inventory/opening-stock');
    const input = await screen.findByLabelText('CSV or Excel file');
    const file = new File(
      ['sku,locationCode,quantity,unitCostCents,receivedAt\nCUE-1,WH,0.5,101,2026-01-15'],
      'initial.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(file, 'text', {
      value: async () =>
        'sku,locationCode,quantity,unitCostCents,receivedAt\nCUE-1,WH,0.5,101,2026-01-15',
    });
    await userEvent.upload(input, file);
    expect(await screen.findByText(/Review 1 rows from initial.csv/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/v1/inventory/opening-stock/imports'),
    ).toHaveLength(0);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Import source reference' }),
      'INITIAL-2',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit import for approval' }));
    expect(
      await screen.findByText('Opening import STKACT-0002 submitted for approval.'),
    ).toBeInTheDocument();
    const creates = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/inventory/opening-stock/imports',
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0]?.[1]?.body))).toMatchObject({
      sourceDoc: { type: 'OPENING_IMPORT', number: 'INITIAL-2' },
      lines: [{ sku: 'CUE-1', locationCode: 'WH', quantity: '0.5', unitCost: 101 }],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Approve import' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Post import' }));
    expect(await screen.findByText('Opening import posted.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/approve'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/post'))).toHaveLength(1);
  });

  it('does not offer import creation to a reader without opening request permission', async () => {
    mockApi(['inventory.requests.read']);
    renderRoute('/inventory/opening-stock');
    expect(await screen.findByText('No imported batches yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('CSV or Excel file')).not.toBeInTheDocument();
  });
});
