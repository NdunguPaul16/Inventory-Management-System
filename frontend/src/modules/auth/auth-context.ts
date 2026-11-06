import { createContext, useContext } from 'react';
import type { AuthUser, LoginInput, z } from '@ims/shared';
import type { ApiRequestOptions } from '../../lib/api';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  authorizedRequest: <T extends z.ZodType>(
    path: string,
    schema: T,
    options?: Omit<ApiRequestOptions, 'accessToken'>,
  ) => Promise<z.infer<T>>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
