export interface ClientIpDiagnosticResult {
  status: number;
  socketPeerId: string | null;
  expressClientId: string | null;
  sameAddress: boolean;
  proxyTrustMode: 'disabled' | 'explicit';
  forwardedStatus: 'absent' | 'valid' | 'malformed';
  forwardedHopCount: number;
}

export class ClientIpDiagnosticError extends Error {
  constructor(public readonly status: number | null) {
    super('Client IP diagnostic request failed');
    this.name = 'ClientIpDiagnosticError';
  }
}
