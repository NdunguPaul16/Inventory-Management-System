import type { RouteObject } from 'react-router';
import { PlaceholderPage } from '../components/PlaceholderPage';
import { SystemStatusPage } from '../modules/dashboard/pages/SystemStatusPage';
import { LoginPage } from '../modules/auth/pages/LoginPage';
import { ProtectedRoute } from '../modules/auth/components/ProtectedRoute';
import { PermissionGate } from '../modules/auth/components/PermissionGate';
import { UsersPage } from '../modules/users/pages/UsersPage';
import { RolesPage } from '../modules/roles/pages/RolesPage';
import { StockBalancesPage } from '../modules/inventory/pages/StockBalancesPage';
import { ItemStockPage } from '../modules/inventory/pages/ItemStockPage';
import { StockCountsPage } from '../modules/inventory/pages/StockCountsPage';
import { StockTransfersPage } from '../modules/inventory/pages/StockTransfersPage';
import { StockAdjustmentsPage } from '../modules/inventory/pages/StockAdjustmentsPage';
import { OpeningStockPage } from '../modules/inventory/pages/OpeningStockPage';
import { StockReconciliationPage } from '../modules/inventory/pages/StockReconciliationPage';
import { MasterDataPage } from '../modules/inventory/pages/MasterDataPage';
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
            path: '/inventory/items',
            element: (
              <PermissionGate permission="inventory.items.read">
                <MasterDataPage kind="items" />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/locations',
            element: (
              <PermissionGate permission="inventory.locations.read">
                <MasterDataPage kind="locations" />
              </PermissionGate>
            ),
          },
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
          {
            path: '/inventory/balances',
            element: (
              <PermissionGate permission="inventory.balances.read">
                <StockBalancesPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/items/:itemId/stock',
            element: (
              <PermissionGate permission="inventory.balances.read">
                <ItemStockPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/counts',
            element: (
              <PermissionGate permission="inventory.counts.read">
                <StockCountsPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/reconciliation',
            element: (
              <PermissionGate permission="inventory.reconciliation.read">
                <StockReconciliationPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/transfers',
            element: (
              <PermissionGate permission="inventory.transfers.post">
                <StockTransfersPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/opening-stock',
            element: (
              <PermissionGate anyOf={['inventory.opening.request', 'inventory.requests.read']}>
                <OpeningStockPage />
              </PermissionGate>
            ),
          },
          {
            path: '/inventory/adjustments',
            element: (
              <PermissionGate anyOf={['inventory.requests.read', 'inventory.adjustments.request']}>
                <StockAdjustmentsPage />
              </PermissionGate>
            ),
          },
          // Each later phase swaps its placeholders for real pages.
          ...PLACEHOLDER_ROUTES.filter(
            ({ path }) =>
              ![
                '/settings/users',
                '/settings/roles',
                '/inventory/balances',
                '/inventory/items',
                '/inventory/locations',
                '/inventory/counts',
                '/inventory/reconciliation',
                '/inventory/transfers',
                '/inventory/adjustments',
                '/inventory/opening-stock',
              ].includes(path),
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
