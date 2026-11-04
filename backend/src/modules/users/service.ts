import * as argon2 from 'argon2';
import type { CreateUserInput, UpdateUserInput } from '@ims/shared';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { writeAuditLog } from '../audit/service.js';
import { Role, type RoleDoc } from '../roles/model.js';
import { User, type UserDoc } from './model.js';

export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function publicRole(role: RoleDoc) {
  return {
    id: String(role._id),
    name: role.name,
    description: role.description ?? null,
    permissions: [...role.permissions].sort(),
    isSystem: role.isSystem,
  };
}

export function permissionsForRoles(roles: RoleDoc[]): string[] {
  return [...new Set(roles.flatMap((role) => role.permissions))].sort();
}

export function publicUser(user: UserDoc, roles: RoleDoc[]) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    roleIds: user.roleIds.map(String),
    roles: roles.map(publicRole),
    permissions: permissionsForRoles(roles),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function requireRoles(roleIds: string[], session?: ClientSession) {
  if (roleIds.some((roleId) => !Types.ObjectId.isValid(roleId))) {
    throw AppError.badRequest('One or more role ids are invalid');
  }
  const roles = await Role.find({ _id: { $in: roleIds } }).session(session ?? null);
  if (roles.length !== new Set(roleIds).size)
    throw AppError.badRequest('One or more roles do not exist');
  return roles;
}

export async function getUserWithRoles(id: string, session?: ClientSession) {
  if (!Types.ObjectId.isValid(id)) return undefined;
  const user = await User.findById(id).session(session ?? null);
  if (!user) return undefined;
  const roles = await Role.find({ _id: { $in: user.roleIds } }).session(session ?? null);
  return { user, roles };
}

export async function listUsers() {
  const users = await User.find().sort({ name: 1 });
  const roleIds = users.flatMap((user) => user.roleIds);
  const roles = await Role.find({ _id: { $in: roleIds } });
  const rolesById = new Map(roles.map((role) => [String(role._id), role]));
  return users.map((user) =>
    publicUser(
      user,
      user.roleIds.flatMap((roleId) => {
        const role = rolesById.get(String(roleId));
        return role ? [role] : [];
      }),
    ),
  );
}

export async function createUser(input: CreateUserInput, actorId: string) {
  const passwordHash = await hashPassword(input.password);
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const roles = await requireRoles(input.roleIds, session);
      const [user] = await User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            roleIds: roles.map((role) => role._id),
          },
        ],
        { session },
      );
      if (!user) throw new Error('User was not created');
      const created = publicUser(user, roles);
      await writeAuditLog({
        actorId,
        action: 'user.create',
        entityType: 'user',
        entityId: user._id,
        after: created,
        session,
      });
      return created;
    });
    if (!result) throw new Error('User transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  const passwordHash =
    input.password !== undefined ? await hashPassword(input.password) : undefined;
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const current = await getUserWithRoles(id, session);
      if (!current) throw AppError.notFound('User not found');
      const before = publicUser(current.user, current.roles);
      const roles = input.roleIds ? await requireRoles(input.roleIds, session) : current.roles;
      if (input.name !== undefined) current.user.name = input.name;
      if (input.isActive !== undefined) current.user.isActive = input.isActive;
      if (input.roleIds !== undefined) current.user.roleIds = roles.map((role) => role._id);
      if (passwordHash !== undefined) current.user.passwordHash = passwordHash;
      await current.user.save({ session });
      const updated = publicUser(current.user, roles);
      await writeAuditLog({
        actorId,
        action: 'user.update',
        entityType: 'user',
        entityId: current.user._id,
        before,
        after: updated,
        metadata: { passwordChanged: passwordHash !== undefined },
        session,
      });
      return updated;
    });
    if (!result) throw new Error('User transaction completed without a result');
    return result;
  } finally {
    await session.endSession();
  }
}

/** Creates the first administrator only when the configured email does not already exist. */
export async function bootstrapAdministrator(email: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  const session = await mongoose.startSession();
  try {
    return (
      (await session.withTransaction(async () => {
        const existing = await User.exists({ email }).session(session);
        if (existing) return false;
        const administrator = await Role.findOne({ name: 'Admin' }).session(session);
        if (!administrator) throw new Error('Default Admin role has not been seeded');
        const [user] = await User.create(
          [
            {
              name: 'Administrator',
              email,
              passwordHash,
              roleIds: [administrator._id],
            },
          ],
          { session },
        );
        if (!user) throw new Error('Bootstrap administrator was not created');
        await writeAuditLog({
          action: 'user.bootstrap',
          entityType: 'user',
          entityId: user._id,
          after: publicUser(user, [administrator]),
          metadata: { source: 'startup' },
          session,
        });
        return true;
      })) ?? false
    );
  } finally {
    await session.endSession();
  }
}
