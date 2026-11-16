import { z } from '@ims/shared';
import { ClientIpDiagnosticError, type ClientIpDiagnosticResult } from './types';

const resultSchema = z.object({
  data: z.object({
    socketPeerId: z
      .string()
      .regex(/^p_[a-f0-9]{24}$/)
      .nullable(),
    expressClientId: z
      .string()
      .regex(/^p_[a-f0-9]{24}$/)
      .nullable(),
    sameAddress: z.boolean(),
    proxyTrustMode: z.enum(['disabled', 'explicit']),
    forwardedStatus: z.enum(['absent', 'valid', 'malformed']),
    forwardedHopCount: z.number().int().min(0).max(16),
  }),
});

/** One same-origin GET. No refresh, retry, redirect, logging, or error-body display. */
export async function clientIpDiagnosticOnce(
  accessToken: string,
): Promise<ClientIpDiagnosticResult> {
  let response: Response;
  try {
    response = await fetch('/api/v1/internal/client-ip-diagnostic', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new ClientIpDiagnosticError(null);
  }

  if (response.status !== 200) throw new ClientIpDiagnosticError(response.status);
  try {
    const parsed = resultSchema.parse(await response.json());
    return { status: response.status, ...parsed.data };
  } catch {
    throw new ClientIpDiagnosticError(response.status);
  }
}
