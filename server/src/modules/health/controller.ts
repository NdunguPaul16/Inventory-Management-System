import type { RequestHandler } from 'express';
import type { HealthResponse } from '@ims/shared';
import { getHealth } from './service.js';

export function healthController(environment: string): RequestHandler {
  return async (_req, res) => {
    const health = await getHealth(environment);
    const body: HealthResponse = { data: health, meta: {} };
    res
      .status(health.status === 'ok' ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(body);
  };
}
