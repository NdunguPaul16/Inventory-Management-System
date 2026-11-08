import type { Health } from '@ims/shared';
import { appInfo } from '../../config/app-info.js';
import { getDbHealth } from '../../config/db.js';

export async function getHealth(
  environment: string,
  rateLimitReady: () => boolean,
): Promise<Health> {
  const db = await getDbHealth();
  const rateLimitStatus = rateLimitReady() ? 'up' : 'down';
  return {
    status: db.status === 'up' && rateLimitStatus === 'up' ? 'ok' : 'degraded',
    app: {
      name: appInfo.name,
      version: appInfo.version,
      environment,
      uptimeSeconds: Math.round(process.uptime()),
    },
    db,
    authRateLimit: { status: rateLimitStatus },
    time: new Date().toISOString(),
  };
}
