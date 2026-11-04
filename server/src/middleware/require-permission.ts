import type { RequestHandler } from 'express';
import type { AuthUser } from '@ims/shared';
import type { Types } from 'mongoose';
import { AppError } from '../lib/errors.js';

export interface AuthContext {
  userId: string | Types.ObjectId;
  permissions: readonly string[];
}

export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.some(
    (candidate) =>
      candidate === '*' ||
      candidate === permission ||
      (candidate.endsWith('.*') && permission.startsWith(candidate.slice(0, -1))),
  );
}

export const requireAuthenticated: RequestHandler = (_req, res, next) => {
  if (!res.locals.auth) return next(AppError.unauthenticated('Sign in is required'));
  return next();
};

declare module 'express-serve-static-core' {
  interface Locals {
    auth?: AuthContext;
    authUser?: AuthUser;
  }
}

/**
 * Authorization gate used by protected API routes. Phase 1 authentication must
 * populate `res.locals.auth`; until then, protected routes fail closed.
 */
export function requirePermission(permission: string): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth;
    if (!auth) return next(AppError.unauthenticated('Sign in is required'));
    if (!hasPermission(auth.permissions, permission)) {
      return next(AppError.forbidden());
    }
    return next();
  };
}
