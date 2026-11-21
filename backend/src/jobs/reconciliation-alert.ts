export type ReconciliationOutcome = 'clean' | 'discrepancy' | 'failure' | 'warning' | 'recovery';

export interface ReconciliationAlert {
  outcome: ReconciliationOutcome;
  at: string;
  checked?: number;
  differences?: number;
  elapsedMs?: number;
}

export interface ReconciliationNotifier {
  send(alert: ReconciliationAlert): Promise<void>;
}

interface EmailSettings {
  apiKey: string;
  from: string;
  to: string[];
}

function email(value: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);
}

/** Read server-only settings. Never include values in validation or provider errors. */
export function reconciliationEmailSettings(source: NodeJS.ProcessEnv): EmailSettings {
  const apiKey = source.RECONCILE_EMAIL_API_KEY?.trim();
  const from = source.RECONCILE_EMAIL_FROM?.trim();
  const to = source.RECONCILE_EMAIL_TO?.split(',').map((entry) => entry.trim()) ?? [];
  if (!apiKey || !from || !email(from) || !to.length || to.some((entry) => !email(entry))) {
    throw new Error('Reconciliation email configuration is incomplete');
  }
  return { apiKey, from, to };
}

/** Minimal Resend REST adapter; transport injection keeps all local tests offline. */
export function createReconciliationEmailNotifier(
  settings: EmailSettings,
  transport: typeof fetch = fetch,
): ReconciliationNotifier {
  return {
    async send(alert) {
      const subject = `Inventory Inc staging stock reconciliation: ${alert.outcome}`;
      const text = [
        `Outcome: ${alert.outcome}`,
        `UTC time: ${alert.at}`,
        `Checked: ${alert.checked ?? 'unknown'}`,
        `Differences: ${alert.differences ?? 'unknown'}`,
        `Duration: ${alert.elapsedMs ?? 'unknown'} ms`,
        'Review the protected staging reconciliation report; no stock was repaired.',
      ].join('\n');
      try {
        const response = await transport('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: settings.from, to: settings.to, subject, text }),
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Notification provider rejected the request');
      } catch {
        throw new Error('Reconciliation notification failed');
      }
    },
  };
}
