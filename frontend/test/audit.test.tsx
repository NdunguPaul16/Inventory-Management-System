import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuthUser } from '@ims/shared';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const AT = '2026-11-08T09:00:00.000Z';

function auditEvent(id: string): AuditEvent {
  return {
    id,
    at: AT,
    action: 'user.update',
    entityType: 'user',
    entityId: ID_A,
    actorId: ID_B,
    summary: 'Recorded user.update',
  };
}

function mockApi(user: AuthUser = testUser(['audit.read'])) {
  const auditPaths: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url.startsWith('/api/v1/audit-logs/'))
      return jsonResponse(200, {
        data: {
          ...auditEvent(ID_A),
          before: { isActive: false },
          after: { isActive: true },
          metadata: {},
        },
        meta: {},
      });
    if (url.startsWith('/api/v1/audit-logs')) {
      auditPaths.push(url);
      const query = new URL(url, 'http://localhost').searchParams;
      if (query.get('action') === 'role.update')
        return jsonResponse(200, { data: [], meta: { hasMore: false, nextCursor: null } });
      if (query.get('cursor'))
        return jsonResponse(200, {
          data: [auditEvent(ID_B)],
          meta: { hasMore: false, nextCursor: null },
        });
      return jsonResponse(200, {
        data: [auditEvent(ID_A)],
        meta: { hasMore: true, nextCursor: 'next-cursor' },
      });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Unexpected request' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { auditPaths, fetchMock };
}

describe('audit history screen', () => {
  it('shows only to permitted users and never fetches history for restricted users', async () => {
    const restricted = mockApi(testUser(['inventory.balances.read'], 'Storekeeper'));
    renderRoute('/audit');
    await screen.findByRole('heading', { name: 'Access denied' });
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    expect(restricted.auditPaths).toHaveLength(0);
  });

  it('searches with URL filters and pages forward and backward', async () => {
    const { auditPaths } = mockApi();
    renderRoute('/audit');
    await screen.findByRole('heading', { name: 'Audit History' });
    await screen.findByRole('button', { name: `View event ${ID_A}` });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: `View event ${ID_B}` });
    expect(auditPaths.at(-1)).toContain('cursor=next-cursor');
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByRole('button', { name: `View event ${ID_A}` });
    fireEvent.change(screen.getByLabelText('Action (exact match)'), {
      target: { value: 'role.update' },
    });
    fireEvent.change(screen.getByLabelText('From (UTC date)'), { target: { value: '2026-01-02' } });
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No audit events match this range or filter.');
    expect(auditPaths.at(-1)).toContain('action=role.update');
    expect(auditPaths.at(-1)).toContain('from=2026-01-02T00%3A00%3A00.000Z');
    expect(auditPaths.at(-1)).not.toContain('cursor=');
  });

  it('shows redacted event details and handles an API error', async () => {
    mockApi();
    renderRoute('/audit');
    await userEvent.click(await screen.findByRole('button', { name: `View event ${ID_A}` }));
    await screen.findByText('Event details');
    expect(screen.getByText(/"isActive": false/)).toBeInTheDocument();
  });

  it('shows a retry action when the history request fails', async () => {
    const user = testUser(['audit.read']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user));
        if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
        if (url === '/api/v1/health') return jsonResponse(200, healthBody());
        return jsonResponse(500, {
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        });
      }),
    );
    renderRoute('/audit');
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
