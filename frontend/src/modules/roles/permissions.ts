import type { RoleRecord } from './api/roles';

/** Known permissions from current routes and seeded roles; backend remains authoritative. */
const KNOWN_PERMISSIONS = [
  '*',
  'users.read',
  'users.create',
  'users.update',
  'roles.read',
  'roles.create',
  'roles.update',
  'dashboard.read',
  'reports.read',
  'reports.*',
  'inventory.balances.read',
  'inventory.layers.read',
  'inventory.movements.read',
  'inventory.reconciliation.read',
  'inventory.requests.read',
  'inventory.opening.request',
  'inventory.opening.approve',
  'inventory.opening.post',
  'inventory.adjustments.request',
  'inventory.adjustments.approve',
  'inventory.adjustments.post',
  'inventory.movements.reverse.request',
  'inventory.movements.reverse.approve',
  'inventory.movements.reverse.post',
  'inventory.transfers.post',
  'inventory.valuation.read',
  'suppliers.*',
  'purchasing.*',
  'purchasing.approve',
  'boms.*',
  'production.*',
  'customers.read',
  'customers.create',
  'sales.read',
  'sales.quotes.create',
  'sales.orders.create',
  'sales.invoices.create',
  'sales.approve',
  'deliveries.create',
  'deliveries.read',
  'receipts.create',
  'finance.*',
  'settings.read',
  'audit.read',
] as const;

const MODULE_NAMES: Record<string, string> = {
  '*': 'Full access',
  users: 'Users',
  roles: 'Roles',
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  suppliers: 'Suppliers',
  purchasing: 'Purchasing',
  boms: 'Bills of materials',
  production: 'Workshop',
  customers: 'Customers',
  sales: 'Sales',
  deliveries: 'Deliveries',
  receipts: 'Receipts',
  finance: 'Finance',
  reports: 'Reports',
  settings: 'Settings',
  audit: 'Audit',
};

export interface PermissionGroup {
  name: string;
  permissions: string[];
}

export function groupPermissions(permissions: readonly string[]): PermissionGroup[] {
  const groups = new Map<string, string[]>();
  for (const permission of [...new Set(permissions)].sort()) {
    const module = permission === '*' ? '*' : permission.split('.')[0]!;
    const name = MODULE_NAMES[module] ?? module;
    const group = groups.get(name) ?? [];
    group.push(permission);
    groups.set(name, group);
  }
  return [...groups.entries()].map(([name, entries]) => ({ name, permissions: entries }));
}

export function permissionChoices(
  roles: readonly RoleRecord[],
  additional: readonly string[] = [],
): PermissionGroup[] {
  return groupPermissions([
    ...KNOWN_PERMISSIONS,
    ...roles.flatMap((role) => role.permissions),
    ...additional,
  ]);
}
