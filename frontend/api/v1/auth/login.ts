import { handleStagingLogin } from '../../../staging-login-gateway/function.js';

/** Vercel discovers this file as /api/v1/auth/login before the broad API rewrite. */
export function POST(request: Request): Promise<Response> {
  return handleStagingLogin(request);
}
