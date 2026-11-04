import type { CreateRoleInput, UpdateRoleInput } from '@ims/shared';
import mongoose, { Types } from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../audit/service.js';
import { Role, type RoleDoc } from './model.js';

export const DEFAULT_ROLES: Array<
  Pick<RoleDoc, 'name' | 'description' | 'permissions' | 'isSystem'>
> = [
  { name: 'Admin', description: 'Full system access', permissions: ['*'], isSystem: true },
  {
    name: 'Owner / Manager',
    description: 'Read access and approval authority',
    permissions: [
      'dashboard.read',
      'reports.read',
      'inventory.balances.read',
      'inventory.layers.read',
      'inventory.movements.read',
      'inventory.reconciliation.read',
      'inventory.requests.read',
      'inventory.opening.approve',
      'inventory.opening.post',
      'inventory.adjustments.request',
      'inventory.adjustments.approve',
      'inventory.adjustments.post',
      'inventory.movements.reverse.request',
      'inventory.movements.reverse.approve',
      'inventory.movements.reverse.post',
      'inventory.transfers.post',
      'purchasing.approve',
      'sales.approve',
      'settings.read',
      'audit.read',
    ],
    isSystem: true,
  },
  {
    name: 'Purchasing Officer',
    description: 'Purchasing and import workflows',
    permissions: ['suppliers.*', 'purchasing.*', 'inventory.balances.read'],
    isSystem: true,
  },
  {
    name: 'Storekeeper',
    description: 'Stock receiving, transfers and counts',
    permissions: [
      'inventory.balances.read',
      'inventory.layers.read',
      'inventory.movements.read',
      'inventory.requests.read',
      'inventory.adjustments.request',
      'inventory.transfers.post',
      'deliveries.create',
      'deliveries.read',
    ],
    isSystem: true,
  },
  {
    name: 'Workshop Supervisor',
    description: 'Workshop and production workflows',
    permissions: ['boms.*', 'production.*', 'inventory.balances.read'],
    isSystem: true,
  },
  {
    name: 'Sales Officer',
    description: 'Sales and customer workflows',
    permissions: [
      'customers.read',
      'customers.create',
      'sales.read',
      'sales.quotes.create',
      'sales.orders.create',
      'sales.invoices.create',
      'receipts.create',
      'inventory.balances.read',
    ],
    isSystem: true,
  },
  {
    name: 'Accountant',
    description: 'Finance and financial reports',
    permissions: ['finance.*', 'reports.*', 'inventory.valuation.read'],
    isSystem: true,
  },
  {
    name: 'Viewer / Auditor',
    description: 'Read-only and audit access',
    permissions: ['dashboard.read', 'reports.read', 'inventory.balances.read', 'audit.read'],
    isSystem: true,
  },
];

function publicRole(role: RoleDoc) {
  return {
    id: String(role._id),
    name: role.name,
    description: role.description ?? null,
    permissions: [...role.permissions].sort(),
    isSystem: role.isSystem,
  };
}

export async function seedDefaultRoles(): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const definition of DEFAULT_ROLES) {
        const role = await Role.findOne({ name: definition.name }).session(session);
        if (!role) {
          const [created] = await Role.create([definition], { session });
          if (!created) throw new Error('Default role was not created');
          await writeAuditLog({
            action: 'role.seed',
            entityType: 'role',
            entityId: created._id,
            after: publicRole(created),
            metadata: { source: 'startup' },
            session,
          });
          continue;
        }
        if (
          role.isSystem !== true ||
          [...role.permissions].sort().join('\0') !== [...definition.permissions].sort().join('\0')
        ) {
          const before = publicRole(role);
          role.permissions = [...definition.permissions];
          role.isSystem = true;
          await role.save({ session });
          await writeAuditLog({
            action: 'role.seed.sync',
            entityType: 'role',
            entityId: role._id,
            before,
            after: publicRole(role),
            metadata: { source: 'startup' },
            session,
          });
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

export async function listRoles() {
  const roles = await Role.find().sort({ name: 1 });
  return roles.map((role) => publicRole(role));
}

export async function createRole(input: CreateRoleInput, actorId: string) {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const [role] = await Role.create(
        [
          {
            ...input,
            permissions: [...new Set(input.permissions)].sort(),
          },
        ],
        { session },
      );
      if (!role) throw new Error('Role was not created');
      const created = publicRole(role);
      await writeAuditLog({
        actorId,
        action: 'role.create',
        entityType: 'role',
        entityId: role._id,
        after: created,
        session,
      });
      return created;
    });
    if (!result) throw new Error('Role transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

export async function updateRole(id: string, input: UpdateRoleInput, actorId: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Role not found');
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const role = await Role.findById(id).session(session);
      if (!role) throw AppError.notFound('Role not found');
      if (
        role.isSystem &&
        (input.permissions !== undefined || (input.name && input.name !== role.name))
      ) {
        throw AppError.badRequest('System role names and permissions cannot be changed');
      }
      const before = publicRole(role);
      if (input.name !== undefined) role.name = input.name;
      if (input.description !== undefined) role.description = input.description ?? undefined;
      if (input.permissions !== undefined)
        role.permissions = [...new Set(input.permissions)].sort();
      await role.save({ session });
      const updated = publicRole(role);
      await writeAuditLog({
        actorId,
        action: 'role.update',
        entityType: 'role',
        entityId: role._id,
        before,
        after: updated,
        session,
      });
      return updated;
    });
    if (!result) throw new Error('Role transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}
