import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Card, PageHeader } from '../../../components/Card';
import { useAuth } from '../../auth/auth-context';
import { runReconciliation, type ReconciliationResult } from '../api/reconciliation';

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' });

export function StockReconciliationPage() {
  const { authorizedRequest } = useAuth();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const checked = await runReconciliation(authorizedRequest);
      setResult(checked);
      setCheckedAt(new Date().toISOString());
    } catch {
      setResult(null);
      setCheckedAt(null);
      setError('Reconciliation could not be completed. No result was recorded; try again later.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Stock reconciliation"
        description="Compare stock balances with FIFO layers and posted movements. This check does not change stock."
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Run this check after stock posting has settled. Review any difference before taking a
            corrective action.
          </p>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? 'Checking stock…' : 'Run reconciliation'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {!result && !error && !busy && (
          <p className="mt-6 text-sm text-slate-500">
            No reconciliation has been run on this page.
          </p>
        )}
        {result && (
          <div className="mt-6" aria-live="polite">
            <p className="text-sm font-medium text-slate-800">
              Checked {result.checked} item-location pairs
              {checkedAt ? ` at ${new Date(checkedAt).toLocaleString()}` : ''}.
            </p>
            {result.differences.length === 0 ? (
              <p className="mt-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                No differences found.
              </p>
            ) : (
              <>
                <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {result.differences.length} stock difference
                  {result.differences.length === 1 ? '' : 's'} found. Investigate before posting
                  more corrections.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[920px] w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                        <th scope="col" className="pb-3 pr-3">
                          Item / location
                        </th>
                        <th scope="col" className="pb-3 pr-3">
                          Balance qty
                        </th>
                        <th scope="col" className="pb-3 pr-3">
                          Ledger qty
                        </th>
                        <th scope="col" className="pb-3 pr-3">
                          Layer qty
                        </th>
                        <th scope="col" className="pb-3 pr-3">
                          Balance value
                        </th>
                        <th scope="col" className="pb-3 pr-3">
                          Ledger value
                        </th>
                        <th scope="col" className="pb-3">
                          Layer value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.differences.map((difference) => (
                        <tr
                          key={`${difference.itemId}:${difference.locationId}`}
                          className="border-b border-slate-100"
                        >
                          <td className="py-3 pr-3">
                            <Link
                              to={`/inventory/items/${difference.itemId}/stock?locationId=${difference.locationId}`}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {difference.itemId} / {difference.locationId}
                            </Link>
                          </td>
                          <td className="py-3 pr-3 tabular-nums">{difference.balanceQty}</td>
                          <td className="py-3 pr-3 tabular-nums">{difference.ledgerQty}</td>
                          <td className="py-3 pr-3 tabular-nums">{difference.layerQty}</td>
                          <td className="py-3 pr-3 tabular-nums">
                            {money.format(difference.balanceValue / 100)}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">
                            {money.format(difference.ledgerValue / 100)}
                          </td>
                          <td className="py-3 tabular-nums">
                            {money.format(difference.layerValue / 100)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
