import type { ReactNode } from 'react';
import { useAuth } from '../auth-context';
import { canAccess } from '../permissions';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';

export function PermissionGate({
  permission,
  children,
}: {
  permission?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !canAccess(user, permission)) return <AccessDeniedPage />;
  return <>{children}</>;
}
