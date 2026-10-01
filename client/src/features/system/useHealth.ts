import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema } from '@ims/shared';
import { apiGet } from '../../lib/api';

export const healthQueryKey = ['health'] as const;

/** Polls `GET /api/v1/health`. A 503 still carries a valid "degraded" body. */
export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) =>
      apiGet('/health', healthResponseSchema, { signal, acceptStatuses: [503] }).then(
        (r) => r.data,
      ),
    refetchInterval: 30_000,
    retry: false,
  });
}
