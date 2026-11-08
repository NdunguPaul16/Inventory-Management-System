import { auditEventDetailResponseSchema, auditHistoryResponseSchema } from '@ims/shared';
import type { AuthContextValue } from '../../auth/auth-context';

type AuthorizedRequest = AuthContextValue['authorizedRequest'];

export async function getAuditHistory(
  request: AuthorizedRequest,
  filters: URLSearchParams,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(filters);
  if (cursor) params.set('cursor', cursor);
  const path = `/audit-logs${params.size ? `?${params.toString()}` : ''}`;
  return request(path, auditHistoryResponseSchema, { signal });
}

export async function getAuditEvent(request: AuthorizedRequest, id: string, signal?: AbortSignal) {
  return (
    await request(`/audit-logs/${encodeURIComponent(id)}`, auditEventDetailResponseSchema, {
      signal,
    })
  ).data;
}
