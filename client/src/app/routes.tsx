import type { RouteObject } from 'react-router';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { SystemStatusPage } from '../features/system/SystemStatusPage';
import { AppLayout } from './AppLayout';
import { PLACEHOLDER_ROUTES, SYSTEM_STATUS_PATH } from './navigation';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { path: SYSTEM_STATUS_PATH, element: <SystemStatusPage /> },
      // Each later phase swaps its placeholders for real pages.
      ...PLACEHOLDER_ROUTES.map(({ path, label, phase }) => ({
        path,
        element: <PlaceholderPage title={label} phase={phase} />,
      })),
      { path: '*', element: <PlaceholderPage title="Page not found" phase={0} /> },
    ],
  },
];
