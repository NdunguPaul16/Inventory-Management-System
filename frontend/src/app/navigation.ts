/**
 * Sidebar menu for every module in spec §15. `phase` is the build phase that delivers
 * the page; until then the route shows a placeholder.
 *
 */
export interface NavLinkItem {
  label: string;
  path: string;
  phase: number;
  permission?: string;
}

export interface NavSection {
  id: string;
  label: string;
  icon: IconName;
  items: NavLinkItem[];
}

export type IconName =
  | 'dashboard'
  | 'inventory'
  | 'purchasing'
  | 'workshop'
  | 'sales'
  | 'finance'
  | 'reports'
  | 'settings'
  | 'audit'
  | 'status';

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    items: [{ label: 'Overview', path: '/', phase: 9 }],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'inventory',
    items: [
      { label: 'Items', path: '/inventory/items', phase: 1, permission: 'inventory.items.read' },
      {
        label: 'Categories',
        path: '/inventory/categories',
        phase: 1,
        permission: 'inventory.categories.read',
      },
      {
        label: 'Locations',
        path: '/inventory/locations',
        phase: 1,
        permission: 'inventory.locations.read',
      },
      {
        label: 'Stock balances',
        path: '/inventory/balances',
        phase: 2,
        permission: 'inventory.balances.read',
      },
      {
        label: 'Adjustments',
        path: '/inventory/adjustments',
        phase: 2,
        permission: 'inventory.adjustments.request',
      },
      {
        label: 'Transfers',
        path: '/inventory/transfers',
        phase: 2,
        permission: 'inventory.transfers.post',
      },
      {
        label: 'Stock counts',
        path: '/inventory/counts',
        phase: 2,
        permission: 'inventory.reconciliation.read',
      },
    ],
  },
  {
    id: 'purchasing',
    label: 'Purchasing',
    icon: 'purchasing',
    items: [
      { label: 'Suppliers', path: '/purchasing/suppliers', phase: 3, permission: 'suppliers.read' },
      {
        label: 'Purchase orders',
        path: '/purchasing/orders',
        phase: 3,
        permission: 'purchasing.read',
      },
      {
        label: 'Import shipments',
        path: '/purchasing/shipments',
        phase: 3,
        permission: 'purchasing.read',
      },
      {
        label: 'Goods received',
        path: '/purchasing/grns',
        phase: 3,
        permission: 'purchasing.read',
      },
      {
        label: 'Supplier invoices',
        path: '/purchasing/invoices',
        phase: 3,
        permission: 'purchasing.read',
      },
      {
        label: 'Landed costs',
        path: '/purchasing/landed-costs',
        phase: 3,
        permission: 'purchasing.read',
      },
      {
        label: 'Purchase returns',
        path: '/purchasing/returns',
        phase: 3,
        permission: 'purchasing.read',
      },
    ],
  },
  {
    id: 'workshop',
    label: 'Workshop',
    icon: 'workshop',
    items: [
      { label: 'Bills of materials', path: '/workshop/boms', phase: 4, permission: 'boms.read' },
      {
        label: 'Production orders',
        path: '/workshop/production-orders',
        phase: 4,
        permission: 'production.read',
      },
      {
        label: 'Material issue',
        path: '/workshop/issue',
        phase: 4,
        permission: 'production.issue',
      },
      {
        label: 'Completion',
        path: '/workshop/completion',
        phase: 4,
        permission: 'production.complete',
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: 'sales',
    items: [
      { label: 'Customers', path: '/sales/customers', phase: 5, permission: 'customers.read' },
      { label: 'Quotations', path: '/sales/quotations', phase: 5, permission: 'sales.read' },
      { label: 'Sales orders', path: '/sales/orders', phase: 5, permission: 'sales.read' },
      { label: 'Cash sale', path: '/sales/cash-sale', phase: 5, permission: 'sales.read' },
      {
        label: 'Delivery notes',
        path: '/sales/deliveries',
        phase: 5,
        permission: 'deliveries.read',
      },
      { label: 'Invoices', path: '/sales/invoices', phase: 5, permission: 'sales.read' },
      { label: 'Credit notes', path: '/sales/credit-notes', phase: 5, permission: 'sales.read' },
      { label: 'Price lists', path: '/sales/price-lists', phase: 5, permission: 'sales.read' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: 'finance',
    items: [
      { label: 'Receipts', path: '/finance/receipts', phase: 7, permission: 'finance.read' },
      {
        label: 'Supplier payments',
        path: '/finance/supplier-payments',
        phase: 7,
        permission: 'finance.read',
      },
      { label: 'Statements', path: '/finance/statements', phase: 7, permission: 'finance.read' },
      { label: 'Ageing', path: '/finance/ageing', phase: 7, permission: 'finance.read' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'reports',
    items: [
      {
        label: 'Valuation',
        path: '/reports/valuation',
        phase: 7,
        permission: 'inventory.valuation.read',
      },
      { label: 'Movements', path: '/reports/movements', phase: 7, permission: 'reports.read' },
      { label: 'Sales', path: '/reports/sales', phase: 7, permission: 'reports.read' },
      { label: 'Margins', path: '/reports/margins', phase: 7, permission: 'reports.read' },
      {
        label: 'Production cost',
        path: '/reports/production-cost',
        phase: 4,
        permission: 'reports.read',
      },
      { label: 'VAT', path: '/reports/vat', phase: 7, permission: 'reports.read' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [
      {
        label: 'Company profile',
        path: '/settings/company',
        phase: 1,
        permission: 'settings.read',
      },
      { label: 'Users', path: '/settings/users', phase: 1, permission: 'users.read' },
      { label: 'Roles', path: '/settings/roles', phase: 1, permission: 'roles.read' },
      {
        label: 'Approval thresholds',
        path: '/settings/approvals',
        phase: 1,
        permission: 'settings.read',
      },
      { label: 'Numbering', path: '/settings/numbering', phase: 1, permission: 'settings.read' },
      { label: 'Taxes', path: '/settings/taxes', phase: 1, permission: 'settings.read' },
      { label: 'Currencies', path: '/settings/currencies', phase: 1, permission: 'settings.read' },
      { label: 'eTIMS', path: '/settings/etims', phase: 6, permission: 'settings.read' },
    ],
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: 'audit',
    items: [{ label: 'Audit log', path: '/audit', phase: 1, permission: 'audit.read' }],
  },
];

export const SYSTEM_STATUS_PATH = '/system/status';

export const PLACEHOLDER_ROUTES: NavLinkItem[] = NAV_SECTIONS.flatMap((s) => s.items);
