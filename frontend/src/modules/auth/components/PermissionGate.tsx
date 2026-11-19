import type { ReactNode } from 'react';
import { useAuth } from '../auth-context';
import { canAccess } from '../permissions';
import { AccessDeniedPage } from '../pages/AccessDeniedPage';

export function PermissionGate({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (
    !user ||
    !canAccess(user, permission) ||
    (anyOf && !anyOf.some((candidate) => canAccess(user, candidate)))
  )
    return <AccessDeniedPage />;
  return <>{children}</>;
}
