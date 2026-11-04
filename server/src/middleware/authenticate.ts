import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { authContextForAccessToken, type AuthConfig } from '../modules/auth/service.js';

/** Attaches the active user to protected requests; anonymous routes pass through unchanged. */
export function authenticate(config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('Authorization');
    if (!header) return next();
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) return next(AppError.unauthenticated('Authorization must use a Bearer token'));
    try {
      const context = await authContextForAccessToken(match[1], config);
      res.locals.auth = { userId: context.userId, permissions: context.permissions };
      res.locals.authUser = context.user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
