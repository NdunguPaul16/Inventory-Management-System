import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const now = '2026-11-18T08:00:00.000Z';
const item = {
  id: ID,
  sku: 'CUE-01',
  name: 'Pool cue',
  type: 'TRADING_GOOD',
  baseUnit: 'PCS',
  trackSerial: false,
  trackBatch: false,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};
const location = {
  id: ID,
  code: 'WH-01',
  name: 'Warehouse',
  type: 'WAREHOUSE',
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

function mockMasterData(permissions: string[]) {
  const user = testUser(permissions);
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.startsWith('/api/v1/inventory/items?'))
      return jsonResponse(200, { data: [item], meta: {} });
    if (url.startsWith('/api/v1/inventory/locations?'))
      return jsonResponse(200, { data: [location], meta: {} });
    if (url === '/api/v1/inventory/items' && method === 'POST')
      return jsonResponse(201, { data: item, meta: {} });
    if (url === `/api/v1/inventory/locations/${ID}` && method === 'PATCH')
      return jsonResponse(200, { data: location, meta: {} });
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('inventory master data pages', () => {
  it('creates an item using the authenticated API and displays the catalog', async () => {
    const calls = mockMasterData(['*']);
    renderRoute('/inventory/items');
    expect(await screen.findByText('CUE-01')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create item' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'SKU' }), 'new-01');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'New item');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Item saved');
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: '/api/v1/inventory/items',
        method: 'POST',
        body: expect.objectContaining({ sku: 'NEW-01', name: 'New item' }),
      }),
    );
  });

  it('submits a base-unit conversion and replenishment fields from the item form', async () => {
    const calls = mockMasterData(['*']);
    renderRoute('/inventory/items');
    await screen.findByText('CUE-01');
    await userEvent.click(screen.getByRole('button', { name: 'Create item' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'SKU' }), 'roll-01');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Cloth roll');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Base unit' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Base unit' }), 'm');
    await userEvent.click(screen.getByRole('button', { name: 'Add unit conversion' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Conversion unit 1' }), 'roll');
    await userEvent.type(screen.getByRole('textbox', { name: 'Base quantity 1' }), '25');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reorder level (base units)' }), '10');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Reorder quantity (base units)' }),
      '25',
    );
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Lead time (days)' }), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Item saved');
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: '/api/v1/inventory/items',
        method: 'POST',
        body: expect.objectContaining({
          sku: 'ROLL-01',
          baseUnit: 'M',
          unitConversions: [{ unit: 'ROLL', baseQuantity: '25' }],
          reorderLevel: '10',
          reorderQty: '25',
          leadTimeDays: 14,
        }),
      }),
    );
  });

  it('allows a reader to view locations but hides edits and denies an unrelated user', async () => {
    const calls = mockMasterData(['inventory.locations.read']);
    renderRoute('/inventory/locations');
    expect(await screen.findByText('WH-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Warehouse' })).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/inventory/locations?'))).toBe(true);
  });

  it('does not call the item API without read permission', async () => {
    const calls = mockMasterData(['dashboard.read']);
    renderRoute('/inventory/items');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/inventory/items'))).toBe(false);
  });
});
