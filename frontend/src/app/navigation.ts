/**
 * Sidebar menu for every module in spec §15. `phase` is the build phase that delivers
 * the page; until then the route shows a placeholder.
 *
 * TODO(phase-1): filter entries by the signed-in user's permissions.
 */
export interface NavLinkItem {
  label: string;
  path: string;
  phase: number;
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
      { label: 'Items', path: '/inventory/items', phase: 1 },
      { label: 'Categories', path: '/inventory/categories', phase: 1 },
      { label: 'Locations', path: '/inventory/locations', phase: 1 },
      { label: 'Stock balances', path: '/inventory/balances', phase: 2 },
      { label: 'Adjustments', path: '/inventory/adjustments', phase: 2 },
      { label: 'Transfers', path: '/inventory/transfers', phase: 2 },
      { label: 'Stock counts', path: '/inventory/counts', phase: 2 },
    ],
  },
  {
    id: 'purchasing',
    label: 'Purchasing',
    icon: 'purchasing',
    items: [
      { label: 'Suppliers', path: '/purchasing/suppliers', phase: 3 },
      { label: 'Purchase orders', path: '/purchasing/orders', phase: 3 },
      { label: 'Import shipments', path: '/purchasing/shipments', phase: 3 },
      { label: 'Goods received', path: '/purchasing/grns', phase: 3 },
      { label: 'Supplier invoices', path: '/purchasing/invoices', phase: 3 },
      { label: 'Landed costs', path: '/purchasing/landed-costs', phase: 3 },
      { label: 'Purchase returns', path: '/purchasing/returns', phase: 3 },
    ],
  },
  {
    id: 'workshop',
    label: 'Workshop',
    icon: 'workshop',
    items: [
      { label: 'Bills of materials', path: '/workshop/boms', phase: 4 },
      { label: 'Production orders', path: '/workshop/production-orders', phase: 4 },
      { label: 'Material issue', path: '/workshop/issue', phase: 4 },
      { label: 'Completion', path: '/workshop/completion', phase: 4 },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: 'sales',
    items: [
      { label: 'Customers', path: '/sales/customers', phase: 5 },
      { label: 'Quotations', path: '/sales/quotations', phase: 5 },
      { label: 'Sales orders', path: '/sales/orders', phase: 5 },
      { label: 'Cash sale', path: '/sales/cash-sale', phase: 5 },
      { label: 'Delivery notes', path: '/sales/deliveries', phase: 5 },
      { label: 'Invoices', path: '/sales/invoices', phase: 5 },
      { label: 'Credit notes', path: '/sales/credit-notes', phase: 5 },
      { label: 'Price lists', path: '/sales/price-lists', phase: 5 },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: 'finance',
    items: [
      { label: 'Receipts', path: '/finance/receipts', phase: 7 },
      { label: 'Supplier payments', path: '/finance/supplier-payments', phase: 7 },
      { label: 'Statements', path: '/finance/statements', phase: 7 },
      { label: 'Ageing', path: '/finance/ageing', phase: 7 },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'reports',
    items: [
      { label: 'Valuation', path: '/reports/valuation', phase: 7 },
      { label: 'Movements', path: '/reports/movements', phase: 7 },
      { label: 'Sales', path: '/reports/sales', phase: 7 },
      { label: 'Margins', path: '/reports/margins', phase: 7 },
      { label: 'Production cost', path: '/reports/production-cost', phase: 4 },
      { label: 'VAT', path: '/reports/vat', phase: 7 },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [
      { label: 'Company profile', path: '/settings/company', phase: 1 },
      { label: 'Users & roles', path: '/settings/users', phase: 1 },
      { label: 'Approval thresholds', path: '/settings/approvals', phase: 1 },
      { label: 'Numbering', path: '/settings/numbering', phase: 1 },
      { label: 'Taxes', path: '/settings/taxes', phase: 1 },
      { label: 'Currencies', path: '/settings/currencies', phase: 1 },
      { label: 'eTIMS', path: '/settings/etims', phase: 6 },
    ],
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: 'audit',
    items: [{ label: 'Audit log', path: '/audit', phase: 1 }],
  },
];

export const SYSTEM_STATUS_PATH = '/system/status';

export const PLACEHOLDER_ROUTES: NavLinkItem[] = NAV_SECTIONS.flatMap((s) => s.items);
