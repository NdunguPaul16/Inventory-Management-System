import { Router } from 'express';
import { authUserResponseSchema, loginSchema } from '@ims/shared';
import { AppError } from '../../lib/errors.js';
import { requireAuthenticated } from '../../middleware/require-permission.js';
import { validate } from '../../middleware/validate.js';
import {
  authenticateCredentials,
  refreshCookieOptions,
  refreshSession,
  revokeRefreshSession,
  type AuthConfig,
} from './service.js';

const REFRESH_COOKIE = 'ims_refresh';

export function authRoutes(config: AuthConfig): Router {
  const router = Router();

  router.post('/login', validate({ body: loginSchema }), async (_req, res) => {
    const result = await authenticateCredentials(res.locals.validated!.body as never, config);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config));
    res.json({ data: { user: result.user, accessToken: result.accessToken }, meta: {} });
  });

  router.post('/refresh', async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken !== 'string')
      throw AppError.unauthenticated('Refresh session is required');
    const result = await refreshSession(refreshToken, config);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config));
    res.json({ data: { user: result.user, accessToken: result.accessToken }, meta: {} });
  });

  router.post('/logout', async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken === 'string') await revokeRefreshSession(refreshToken, config);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(config));
    res.status(204).end();
  });

  router.get('/me', requireAuthenticated, (_req, res) => {
    const user = res.locals.authUser;
    if (!user) throw AppError.unauthenticated();
    res.json(authUserResponseSchema.parse({ data: user, meta: {} }));
  });

  return router;
}
