import type { RouteObject } from 'react-router';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { SystemStatusPage } from '../modules/dashboard/pages/SystemStatusPage';
import { LoginPage } from '../modules/auth/pages/LoginPage';
import { ProtectedRoute } from '../modules/auth/components/ProtectedRoute';
import { PermissionGate } from '../modules/auth/components/PermissionGate';
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
          // Each later phase swaps its placeholders for real pages.
          ...PLACEHOLDER_ROUTES.map(({ path, label, phase, permission }) => ({
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
