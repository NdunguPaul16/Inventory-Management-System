import { z } from 'zod';
import { apiSuccessSchema } from './api.js';

export const permissionSchema = z
  .string()
  .regex(/^(?:\*|[a-z]+(?:\.(?:[a-z][a-zA-Z]*|\*))+)$/, 'invalid permission');

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(permissionSchema),
  isSystem: z.boolean(),
});

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  roleIds: z.array(z.string()),
  roles: z.array(roleSchema),
  permissions: z.array(permissionSchema),
  isActive: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const loginSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(1_024),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(1_024),
  roleIds: z
    .array(z.string().regex(/^[a-f\d]{24}$/i))
    .min(1)
    .max(20),
});
export const bootstrapAdminSchema = createUserSchema.omit({ roleIds: true });

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    isActive: z.boolean().optional(),
    roleIds: z
      .array(z.string().regex(/^[a-f\d]{24}$/i))
      .min(1)
      .max(20)
      .optional(),
    password: z.string().min(12).max(1_024).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(permissionSchema).min(1).max(250),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    permissions: z.array(permissionSchema).min(1).max(250).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

export const authUserSchema = userSchema.pick({
  id: true,
  name: true,
  email: true,
  roles: true,
  permissions: true,
});
export const authUserResponseSchema = apiSuccessSchema(authUserSchema);
export type AuthUser = z.infer<typeof authUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type BootstrapAdminInput = z.infer<typeof bootstrapAdminSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
