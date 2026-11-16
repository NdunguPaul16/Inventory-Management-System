import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/modules/auth/AuthProvider';
import { useAuth } from '../src/modules/auth/auth-context';
import { healthBody, jsonResponse, renderRoute, sessionBody, testUser } from './utils';

const PATH = '/api/v1/internal/client-ip-diagnostic';
const PAGE = '/internal/client-ip-diagnostic';
const idA = `p_${'a'.repeat(24)}`;
const idB = `p_${'b'.repeat(24)}`;

function accessToken(expiresInSeconds = 600) {
  const payload = btoa(
    JSON.stringify({ type: 'access', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function diagnosticBody(extra: Record<string, unknown> = {}) {
  return {
    data: {
      socketPeerId: idA,
      expressClientId: idB,
      sameAddress: false,
      proxyTrustMode: 'disabled',
      forwardedStatus: 'valid',
      forwardedHopCount: 2,
      ...extra,
    },
    meta: {},
  };
}

function mockSession(user = testUser(), token = accessToken(), diagnosticStatus = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/refresh') return jsonResponse(200, sessionBody(user, token));
    if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
    if (url === '/api/v1/health') return jsonResponse(200, healthBody());
    if (url === PATH)
      return jsonResponse(
        diagnosticStatus,
        diagnosticStatus === 200
          ? diagnosticBody({ secret: 'must-not-display', rawIp: 'must-not-display' })
          : { error: { code: 'ERROR', message: 'must-not-display' } },
      );
    throw new Error('Unexpected mocked URL');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function arm() {
  await userEvent.click(screen.getByRole('checkbox'));
  return screen.getByRole('button', { name: 'Send one diagnostic GET' });
}

describe('staging client-IP diagnostic page', () => {
  it('does not request diagnostics or health on mount or while left open', async () => {
    const fetchMock = mockSession();
    const { router } = renderRoute(PAGE);
    expect(
      await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send one diagnostic GET' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/health')).toHaveLength(0);
    // Normal authentication bootstrap still occurs; it is separate from the diagnostic budget.
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/me')).toHaveLength(1);
    await act(async () => {
      await router.navigate(PAGE);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/health')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
    vi.useFakeTimers();
    try {
      act(() => vi.advanceTimersByTime(31_000));
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/health')).toHaveLength(0);
      expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies users without a system Admin wildcard role before any diagnostic GET', async () => {
    const storekeeper = testUser(['inventory.balances.read'], 'Storekeeper');
    const fetchMock = mockSession(storekeeper);
    renderRoute(PAGE);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
  });

  it('denies a non-system Admin role even with wildcard permission', async () => {
    const user = testUser();
    user.roles[0]!.isSystem = false;
    const fetchMock = mockSession(user);
    renderRoute(PAGE);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
  });

  it('denies a system Admin role without wildcard permission', async () => {
    const user = testUser();
    user.roles[0]!.permissions = [];
    user.permissions = [];
    const fetchMock = mockSession(user);
    renderRoute(PAGE);
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
  });

  it('sends exactly one fixed GET per click and shows only allowlisted fields', async () => {
    const token = accessToken();
    const fetchMock = mockSession(testUser(), token);
    renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    await userEvent.click(await arm());
    expect(await screen.findByText(idA)).toBeInTheDocument();
    expect(screen.getByText(idB)).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.queryByText('must-not-display')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      PATH,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
    expect(screen.getByRole('button', { name: 'Send one diagnostic GET' })).toBeDisabled();
  });

  it.each([401, 403, 404, 503])(
    'handles HTTP %i without refresh, retry, or server-message display',
    async (status) => {
      const fetchMock = mockSession(testUser(), accessToken(), status);
      renderRoute(PAGE);
      await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
      await userEvent.click(await arm());
      expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP status: ${status}`);
      expect(screen.queryByText('must-not-display')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send one diagnostic GET' })).toBeDisabled();
      expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(
        1,
      );
    },
  );

  it.each(['expired', 'malformed'])('stops locally for an %s access token', async (kind) => {
    const token = kind === 'expired' ? accessToken(-1) : 'malformed';
    const fetchMock = mockSession(testUser(), token);
    renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    await userEvent.click(await arm());
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP status: no response');
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('stops locally when no access token is present', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/auth/refresh')
        return jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Unavailable' } });
      throw new Error('Unexpected mocked URL');
    });
    vi.stubGlobal('fetch', fetchMock);

    function MissingTokenProbe() {
      const { clientIpDiagnosticOnce } = useAuth();
      const [outcome, setOutcome] = useState('');
      return (
        <>
          <button
            onClick={() =>
              clientIpDiagnosticOnce
                ? void clientIpDiagnosticOnce().catch(() => setOutcome('stopped'))
                : setOutcome('stopped')
            }
          >
            Probe
          </button>
          <span>{outcome}</span>
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <MissingTokenProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Probe' }));
    expect(await screen.findByText('stopped')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(0);
  });

  it('blocks concurrent clicks while the single request is in flight', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const user = testUser();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/auth/refresh')
        return jsonResponse(200, sessionBody(user, accessToken()));
      if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
      if (url === PATH) return pending;
      throw new Error('Unexpected mocked URL');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    const button = await arm();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
    finish(jsonResponse(200, diagnosticBody()));
    expect(await screen.findByText(idA)).toBeInTheDocument();
  });

  it('keeps the in-flight guard when the page is unmounted and remounted', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const user = testUser();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/auth/refresh')
        return jsonResponse(200, sessionBody(user, accessToken()));
      if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
      if (url === '/api/v1/health') return jsonResponse(200, healthBody());
      if (url === PATH) return pending;
      throw new Error('Unexpected mocked URL');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { router } = renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    await userEvent.click(await arm());
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
    await act(async () => {
      await router.navigate('/dashboard');
    });
    await act(async () => {
      await router.navigate(PAGE);
    });
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    await userEvent.click(await arm());
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP status: no response');
    await act(async () => {
      finish(jsonResponse(200, diagnosticBody()));
    });
  });

  it('disarms after dispatch and requires fresh acknowledgment for another request', async () => {
    const fetchMock = mockSession();
    renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    const button = await arm();
    await userEvent.click(button);
    expect(await screen.findByText(idA)).toBeInTheDocument();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
    await userEvent.click(await arm());
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(2);
  });

  it('treats a failed network request as consumed and does not retry it', async () => {
    const user = testUser();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/auth/refresh')
        return jsonResponse(200, sessionBody(user, accessToken()));
      if (url === '/api/v1/auth/me') return jsonResponse(200, { data: user, meta: {} });
      if (url === PATH) throw new Error('private network details');
      throw new Error('Unexpected mocked URL');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(PAGE);
    await screen.findByRole('heading', { name: 'Temporary staging client-IP diagnostic' });
    await userEvent.click(await arm());
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP status: no response');
    expect(screen.queryByText('private network details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send one diagnostic GET' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => url === PATH)).toHaveLength(1);
  });
});
