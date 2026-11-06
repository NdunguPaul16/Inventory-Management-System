import type { RouteObject } from 'react-router';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { SystemStatusPage } from '../modules/dashboard/pages/SystemStatusPage';
import { LoginPage } from '../modules/auth/pages/LoginPage';
import { ProtectedRoute } from '../modules/auth/components/ProtectedRoute';
import { PermissionGate } from '../modules/auth/components/PermissionGate';
import { UsersPage } from '../modules/users/pages/UsersPage';
import { RolesPage } from '../modules/roles/pages/RolesPage';
import { AppLayout } from './AppLayout';
import { PLACEHOLDER_ROUTES, SYSTEM_STATUS_PATH } from './navigation';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { path: SYSTEM_STATUS_PATH, element: <SystemStatusPage /> },
          {
            path: '/settings/users',
            element: (
              <PermissionGate permission="users.read">
                <UsersPage />
              </PermissionGate>
            ),
          },
          {
            path: '/settings/roles',
            element: (
              <PermissionGate permission="roles.read">
                <RolesPage />
              </PermissionGate>
            ),
          },
          // Each later phase swaps its placeholders for real pages.
          ...PLACEHOLDER_ROUTES.filter(
            ({ path }) => !['/settings/users', '/settings/roles'].includes(path),
          ).map(({ path, label, phase, permission }) => ({
            path,
            element: (
              <PermissionGate permission={permission}>
                <PlaceholderPage title={label} phase={phase} />
              </PermissionGate>
            ),
          })),
          { path: '*', element: <PlaceholderPage title="Page not found" phase={0} /> },
        ],
      },
    ],
  },
];
