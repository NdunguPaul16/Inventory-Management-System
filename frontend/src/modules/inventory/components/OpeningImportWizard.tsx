import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { openingStockImportSchema, rejectStockActionSchema } from '@ims/shared';
import { Card } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { ApiRequestError } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import {
  approveOpeningBatch,
  listOpeningBatches,
  postOpeningBatch,
  rejectOpeningBatch,
  requestOpeningImport,
  type OpeningBatchRecord,
} from '../api/opening-import';
import { parseOpeningFile } from '../opening-import';

type Lines = Awaited<ReturnType<typeof parseOpeningFile>>;

export function OpeningImportWizard() {
  const { user, authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [lines, setLines] = useState<Lines>([]);
  const [fileName, setFileName] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [rejecting, setRejecting] = useState<OpeningBatchRecord | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const canRequest = Boolean(user && canAccess(user, 'inventory.opening.request'));
  const canRead = Boolean(user && canAccess(user, 'inventory.requests.read'));
  const canApprove = Boolean(user && canAccess(user, 'inventory.opening.approve'));
  const canPost = Boolean(user && canAccess(user, 'inventory.opening.post'));
  const history = useInfiniteQuery({
    queryKey: ['inventory', 'opening', 'batches'],
    queryFn: ({ pageParam, signal }) => listOpeningBatches(authorizedRequest, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length === 20 ? page.at(-1)?.id : undefined),
    enabled: canRead,
    retry: false,
  });

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setLines([]);
    setFileName('');
    setError(null);
    setSuccess(null);
    if (!file) return;
    setLoadingFile(true);
    try {
      const parsed = await parseOpeningFile(file);
      setLines(parsed);
      setFileName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read.');
    } finally {
      setLoadingFile(false);
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain || !lines.length) return;
    const parsed = openingStockImportSchema.safeParse({
      sourceDoc: {
        type: 'OPENING_IMPORT',
        id: globalThis.crypto.randomUUID(),
        number: reference.trim(),
      },
      lines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review the import before submitting.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await requestOpeningImport(authorizedRequest, parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'opening'] });
      setSuccess(`Opening import ${created.actionNo} submitted for approval.`);
      setLines([]);
      setFileName('');
      setReference('');
    } catch (cause) {
      if (!(cause instanceof ApiRequestError) || cause.status >= 500) {
        setUncertain(true);
        setError(
          'The result is uncertain. Check imported-batch history before another submission.',
        );
      } else {
        setError(cause.message);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<unknown>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setRejecting(null);
      setSuccess(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The opening-stock action failed.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejecting) return;
    const parsed = rejectStockActionSchema.safeParse({ reason: rejectionReason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a rejection reason.');
      return;
    }
    void runAction(
      () => rejectOpeningBatch(authorizedRequest, rejecting.id, parsed.data.reason),
      'Opening import rejected.',
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {success}
        </p>
      )}
      {canRequest && (
        <Card title="Import opening stock from CSV or Excel">
          <p className="mb-4 text-sm text-slate-600">
            Existing active item SKUs and location codes are required. Use columns sku,
            locationCode, quantity, unitCostCents; optional receivedAt (YYYY-MM-DD) and
            serialNumbers (separated by semicolons). One file creates one reviewable request, with
            up to 100 rows. Stock is unchanged until approval and posting.
          </p>
          <form onSubmit={(event) => void submitImport(event)} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              CSV or Excel file
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => void chooseFile(event)}
                disabled={busy || loadingFile || uncertain}
                className="mt-1 block w-full text-sm"
              />
            </label>
            <label className="block max-w-xl text-sm font-medium text-slate-700">
              Import source reference
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                maxLength={80}
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            {loadingFile && <p role="status">Reading file…</p>}
            {lines.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium">
                  Review {lines.length} rows from {fileName}
                </p>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="p-2">Row</th>
                      <th className="p-2">SKU</th>
                      <th className="p-2">Location</th>
                      <th className="p-2">Quantity</th>
                      <th className="p-2">Cost (cents)</th>
                      <th className="p-2">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.lineId} className="border-t border-slate-200">
                        <td className="p-2">{line.lineId}</td>
                        <td className="p-2">{line.sku}</td>
                        <td className="p-2">{line.locationCode}</td>
                        <td className="p-2">{line.quantity}</td>
                        <td className="p-2">{line.unitCost}</td>
                        <td className="p-2">{line.receivedAt?.slice(0, 10) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="submit"
              disabled={!lines.length || busy || loadingFile || uncertain}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Submitting…' : 'Submit import for approval'}
            </button>
          </form>
        </Card>
      )}
      {rejecting && (
        <Card title={`Reject ${rejecting.actionNo}`}>
          <form onSubmit={submitRejection} className="space-y-3">
            <label className="block text-sm font-medium">
              Reason
              <textarea
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                required
                maxLength={500}
                className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40"
            >
              Confirm rejection
            </button>
          </form>
        </Card>
      )}
      {canRead && (
        <Card title="Imported opening-stock batches">
          {history.isPending ? (
            <p role="status">Loading imports…</p>
          ) : history.isError ? (
            <p role="alert">
              Could not load imports.{' '}
              <button type="button" onClick={() => void history.refetch()} className="underline">
                Retry
              </button>
            </p>
          ) : history.data.pages[0]?.length === 0 ? (
            <p>No imported batches yet.</p>
          ) : (
            <>
              <div className="space-y-3">
                {history.data.pages.flat().map((record) => (
                  <section key={record.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">
                          {record.actionNo} · {record.payload.lines.length} rows
                        </h3>
                        <p className="text-sm text-slate-600">
                          {record.payload.sourceDoc.number} · {formatDateTime(record.createdAt)}
                        </p>
                      </div>
                      <StatusBadge
                        tone={
                          record.status === 'POSTED'
                            ? 'success'
                            : record.status === 'REJECTED'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {record.status.replaceAll('_', ' ')}
                      </StatusBadge>
                    </div>
                    {record.rejectionReason && (
                      <p className="mt-2 text-sm text-red-700">
                        Rejected: {record.rejectionReason}
                      </p>
                    )}
                    <details open={record.status === 'PENDING_APPROVAL'} className="mt-3 text-sm">
                      <summary className="cursor-pointer font-medium text-slate-700">
                        Review batch lines
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-left">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="p-2">Row</th>
                              <th className="p-2">Item</th>
                              <th className="p-2">Location</th>
                              <th className="p-2">Quantity</th>
                              <th className="p-2">Cost (cents)</th>
                              <th className="p-2">Received</th>
                              <th className="p-2">Serials</th>
                            </tr>
                          </thead>
                          <tbody>
                            {record.payload.lines.map((line) => (
                              <tr key={line.lineId} className="border-t border-slate-200">
                                <td className="p-2">{line.lineId}</td>
                                <td className="p-2">{line.sku ?? line.itemId}</td>
                                <td className="p-2">{line.locationCode ?? line.locationId}</td>
                                <td className="p-2">{line.quantity}</td>
                                <td className="p-2">{line.unitCost}</td>
                                <td className="p-2">{line.receivedAt?.slice(0, 10) ?? '—'}</td>
                                <td className="p-2">{line.serialNumbers?.join('; ') ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.status === 'PENDING_APPROVAL' &&
                        canApprove &&
                        (user?.id !== record.requestedBy || user?.permissions.includes('*')) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(
                                () => approveOpeningBatch(authorizedRequest, record.id),
                                'Opening import approved.',
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                          >
                            Approve import
                          </button>
                        )}
                      {record.status === 'PENDING_APPROVAL' && canApprove && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejecting(record);
                            setRejectionReason('');
                          }}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40"
                        >
                          Reject import
                        </button>
                      )}
                      {record.status === 'APPROVED' &&
                        canPost &&
                        user?.id === record.approvedBy && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(
                                () => postOpeningBatch(authorizedRequest, record.id),
                                'Opening import posted.',
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                          >
                            Post import
                          </button>
                        )}
                    </div>
                  </section>
                ))}
              </div>
              {history.hasNextPage && (
                <button
                  type="button"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                  className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
                >
                  Load earlier imports
                </button>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
