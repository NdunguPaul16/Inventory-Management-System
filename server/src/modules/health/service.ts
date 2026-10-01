import type { Health } from '@ims/shared';
import { appInfo } from '../../config/app-info.js';
import { getDbHealth } from '../../config/db.js';

export async function getHealth(environment: string): Promise<Health> {
  const db = await getDbHealth();
  return {
    status: db.status === 'up' ? 'ok' : 'degraded',
    app: {
      name: appInfo.name,
      version: appInfo.version,
      environment,
      uptimeSeconds: Math.round(process.uptime()),
    },
    db,
    time: new Date().toISOString(),
  };
}
