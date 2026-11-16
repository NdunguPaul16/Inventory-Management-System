import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { AuthUser } from '@ims/shared';
import type { AuthContextValue, AuthStatus } from '../auth/auth-context';
import { clientIpDiagnosticOnce } from './request';
import { ClientIpDiagnosticError } from './types';

/** Local expiry check only; backend authentication remains authoritative. */
function unexpiredAccessToken(token: string): boolean {
  try {
    const segment = token.split('.')[1];
    if (!segment) return false;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!payload || typeof payload !== 'object') return false;
    const claims = payload as { type?: unknown; exp?: unknown };
    return (
      claims.type === 'access' &&
      typeof claims.exp === 'number' &&
      claims.exp > Date.now() / 1000 + 5
    );
  } catch {
    return false;
  }
}

/** The provider outlives page navigation, so its guard also covers route remounts. */
export function useAuthExtension(
  session: { status: AuthStatus; user: AuthUser | null },
  accessToken: RefObject<string | null>,
): Partial<AuthContextValue> {
  const inFlight = useRef(false);
  const request = useCallback(async () => {
    if (inFlight.current) throw new ClientIpDiagnosticError(null);
    const isSystemAdmin = session.user?.roles.some(
      (role) => role.name === 'Admin' && role.isSystem && role.permissions.includes('*'),
    );
    const token = accessToken.current;
    if (
      session.status !== 'authenticated' ||
      !isSystemAdmin ||
      !token ||
      !unexpiredAccessToken(token)
    ) {
      throw new ClientIpDiagnosticError(null);
    }
    inFlight.current = true;
    try {
      return await clientIpDiagnosticOnce(token);
    } finally {
      inFlight.current = false;
    }
  }, [session.status, session.user, accessToken]);
  return useMemo(() => ({ clientIpDiagnosticOnce: request }), [request]);
}
