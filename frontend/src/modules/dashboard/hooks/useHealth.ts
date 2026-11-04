import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/health';

export const healthQueryKey = ['health'] as const;

/** Polls `GET /api/v1/health`. A 503 still carries a valid "degraded" body. */
export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 30_000,
    retry: false,
  });
}
