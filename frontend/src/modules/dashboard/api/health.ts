import { healthResponseSchema } from '@ims/shared';
import { apiGet } from '../../../lib/api';

export async function getHealth(signal?: AbortSignal) {
  const response = await apiGet('/health', healthResponseSchema, {
    signal,
    acceptStatuses: [503],
  });
  return response.data;
}
