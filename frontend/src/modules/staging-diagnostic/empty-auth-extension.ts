import type { RefObject } from 'react';
import type { AuthUser } from '@ims/shared';
import type { AuthContextValue, AuthStatus } from '../auth/auth-context';

const empty: Partial<AuthContextValue> = {};

/** Production artifact supplies no temporary authentication methods. */
export function useAuthExtension(
  _session: { status: AuthStatus; user: AuthUser | null },
  _accessToken: RefObject<string | null>,
): Partial<AuthContextValue> {
  return empty;
}
