import { Router } from 'express';
import { healthController } from './controller.js';

/** Public: load balancers and the status page call it without a session. */
export function healthRoutes(environment: string): Router {
  const router = Router();
  router.get('/', healthController(environment));
  return router;
}
