import { useRef, useState } from 'react';
import { Card, PageHeader } from '../../components/Card';
import { useAuth } from '../auth/auth-context';
import { AccessDeniedPage } from '../auth/pages/AccessDeniedPage';
import { ClientIpDiagnosticError, type ClientIpDiagnosticResult } from './types';

function safeMessage(status: number | null): string {
  switch (status) {
    case 401:
      return 'Administrator session unavailable or expired. Stop and arrange a separately approved session step.';
    case 403:
      return 'Access denied by the staging backend. Stop the test.';
    case 404:
      return 'The staging diagnostic is disabled or expired. Stop the test.';
    case 503:
      return 'The staging service is unavailable. Stop the test.';
    default:
      return 'The diagnostic did not return an expected response. Stop the test.';
  }
}

export function ClientIpDiagnosticPage() {
  const { user, clientIpDiagnosticOnce } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ClientIpDiagnosticResult | null>(null);
  const [failure, setFailure] = useState<{ status: number | null; message: string } | null>(null);
  const inFlight = useRef(false);
  const isSystemAdmin = user?.roles.some(
    (role) => role.name === 'Admin' && role.isSystem && role.permissions.includes('*'),
  );

  if (!isSystemAdmin) return <AccessDeniedPage />;

  async function measureOnce() {
    if (!confirmed || inFlight.current || !clientIpDiagnosticOnce) return;
    inFlight.current = true;
    setConfirmed(false);
    setPending(true);
    setResult(null);
    setFailure(null);
    try {
      setResult(await clientIpDiagnosticOnce());
    } catch (error) {
      const status = error instanceof ClientIpDiagnosticError ? error.status : null;
      setFailure({ status, message: safeMessage(status) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Temporary staging client-IP diagnostic"
        description="Each press sends one authenticated GET through this Preview's staging API rewrite."
      />
      <Card title="Controlled measurement">
        <p className="mb-4 text-sm text-slate-600">
          This page cannot check Render activation without spending a diagnostic request. Confirm
          the approved UTC window and healthy staging service before enabling the button. Stop after
          an unexpected result; the page never retries. A fresh application load may separately
          restore your session through the normal authentication endpoints.
        </p>
        <label className="mb-4 flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={pending}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I have confirmed the approved staging diagnostic window and request budget.
        </label>
        <button
          type="button"
          disabled={!confirmed || pending}
          onClick={() => void measureOnce()}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? 'Measuring…' : 'Send one diagnostic GET'}
        </button>
        {!confirmed && !pending && !result && !failure && (
          <p role="status" className="mt-3 text-sm text-slate-600">
            Disabled until you confirm the approved window.
          </p>
        )}
        {failure && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            HTTP status: {failure.status ?? 'no response'}. {failure.message}
          </p>
        )}
        {result && (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2" aria-label="Diagnostic result">
            <div>
              <dt>HTTP status</dt>
              <dd>{result.status}</dd>
            </div>
            <div>
              <dt>socketPeerId</dt>
              <dd>{result.socketPeerId ?? 'null'}</dd>
            </div>
            <div>
              <dt>expressClientId</dt>
              <dd>{result.expressClientId ?? 'null'}</dd>
            </div>
            <div>
              <dt>sameAddress</dt>
              <dd>{String(result.sameAddress)}</dd>
            </div>
            <div>
              <dt>proxyTrustMode</dt>
              <dd>{result.proxyTrustMode}</dd>
            </div>
            <div>
              <dt>forwardedStatus</dt>
              <dd>{result.forwardedStatus}</dd>
            </div>
            <div>
              <dt>forwardedHopCount</dt>
              <dd>{result.forwardedHopCount}</dd>
            </div>
          </dl>
        )}
      </Card>
    </>
  );
}
