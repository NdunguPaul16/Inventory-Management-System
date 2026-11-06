import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser, LoginInput, z } from '@ims/shared';
import { ApiRequestError, apiRequest, type ApiRequestOptions } from '../../lib/api';
import { currentUser, login, logout, refresh } from './api/auth';
import { AuthContext, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<{ status: AuthStatus; user: AuthUser | null }>({
    status: 'checking',
    user: null,
  });
  const accessToken = useRef<string | null>(null);
  const sessionVersion = useRef(0);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const bootstrapStarted = useRef(false);

  const clearSession = useCallback(() => {
    sessionVersion.current += 1;
    accessToken.current = null;
    queryClient.clear();
    setSession({ status: 'anonymous', user: null });
  }, [queryClient]);

  const refreshSession = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const version = sessionVersion.current;
    const pending = (async () => {
      try {
        const response = await refresh();
        const user = await currentUser(response.data.accessToken);
        if (version !== sessionVersion.current) return false;
        accessToken.current = response.data.accessToken;
        setSession({ status: 'authenticated', user });
        return true;
      } catch {
        if (version === sessionVersion.current) clearSession();
        return false;
      }
    })();
    refreshInFlight.current = pending;
    void pending.then(() => {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
    });
    return pending;
  }, [clearSession]);

  useEffect(() => {
    // StrictMode replays effects; the same provider instance must rotate the cookie only once.
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (input: LoginInput) => {
    const version = ++sessionVersion.current;
    const response = await login(input);
    const user = await currentUser(response.data.accessToken);
    if (version !== sessionVersion.current) return;
    accessToken.current = response.data.accessToken;
    setSession({ status: 'authenticated', user });
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    clearSession();
  }, [clearSession]);

  const authorizedRequest = useCallback(
    async <T extends z.ZodType>(
      path: string,
      schema: T,
      options: Omit<ApiRequestOptions, 'accessToken'> = {},
    ): Promise<z.infer<T>> => {
      if (!accessToken.current && !(await refreshSession())) {
        throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in to continue');
      }
      const token = accessToken.current;
      if (!token) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in to continue');
      try {
        return await apiRequest(path, schema, { ...options, accessToken: token });
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
        // A parallel request may already have refreshed the shared access token.
        if (accessToken.current === token && !(await refreshSession())) throw error;
        const nextToken = accessToken.current;
        if (!nextToken) throw error;
        try {
          return await apiRequest(path, schema, { ...options, accessToken: nextToken });
        } catch (retryError) {
          if (retryError instanceof ApiRequestError && retryError.status === 401) clearSession();
          throw retryError;
        }
      }
    },
    [clearSession, refreshSession],
  );

  const value = useMemo(
    () => ({
      status: session.status,
      user: session.user,
      login: signIn,
      logout: signOut,
      authorizedRequest,
    }),
    [session, signIn, signOut, authorizedRequest],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
