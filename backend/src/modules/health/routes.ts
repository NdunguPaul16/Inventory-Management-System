import { Router } from 'express';
import { healthController } from './controller.js';

/** Public: load balancers and the status page call it without a session. */
export function healthRoutes(environment: string, rateLimitReady: () => boolean): Router {
  const router = Router();
  router.get('/', healthController(environment, rateLimitReady));
  return router;
}
