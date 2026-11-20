import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import {
  isSystemStockApprover,
  openingStockSchema,
  rejectStockActionSchema,
  type OpeningStockInput,
} from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { ApiRequestError } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import {
  approveOpeningStock,
  listOpeningRequests,
  postOpeningStockRequest,
  rejectOpeningStock,
  requestOpeningStock,
  type OpeningRecord,
  type OpeningStatus,
} from '../api/opening';
import type { StockItemOption } from '../api/references';
import { StockItemSelect, StockLocationSelect } from '../components/StockReferenceSelect';
import { OpeningImportWizard } from '../components/OpeningImportWizard';

const PAGE_SIZE = 20;
const statuses: OpeningStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'];

function parseSerials(value: string) {
  return value
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
}

export function OpeningStockPage() {
  const { user, authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [item, setItem] = useState<StockItemOption | null>(null);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [serials, setSerials] = useState('');
  const [statusFilter, setStatusFilter] = useState<OpeningStatus | ''>('');
  const [rejecting, setRejecting] = useState<OpeningRecord | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const canRequest = Boolean(user && canAccess(user, 'inventory.opening.request'));
  const canRead = Boolean(user && canAccess(user, 'inventory.requests.read'));
  const canApprove = Boolean(
    user && isSystemStockApprover(user) && canAccess(user, 'inventory.opening.approve'),
  );
  const canPost = Boolean(
    user && isSystemStockApprover(user) && canAccess(user, 'inventory.opening.post'),
  );
  const history = useInfiniteQuery({
    queryKey: ['inventory', 'opening', statusFilter],
    queryFn: ({ pageParam, signal }) =>
      listOpeningRequests(authorizedRequest, statusFilter || undefined, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.id : undefined,
    enabled: canRead,
    retry: false,
  });

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

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain) return;
    setError(null);
    setSuccess(null);
    if (!item || !locationId) {
      setError('Select an item and location.');
      return;
    }
    if (receivedDate && !Number.isFinite(Date.parse(`${receivedDate}T00:00:00.000Z`))) {
      setError('Enter a valid receipt date.');
      return;
    }
    const input: OpeningStockInput = {
      itemId: item.id,
      locationId,
      quantity: quantity.trim(),
      unitCost: Number(unitCost),
      sourceDoc: {
        type: 'OPENING_STOCK_ENTRY',
        id: globalThis.crypto.randomUUID(),
        number: reference.trim(),
      },
      ...(receivedDate ? { receivedAt: `${receivedDate}T00:00:00.000Z` } : {}),
      ...(item.trackSerial ? { serialNumbers: parseSerials(serials) } : {}),
    };
    const parsed = openingStockSchema.safeParse(input);
    if (!parsed.success || Number(quantity) <= 0 || unitCost.trim() === '') {
      setError(parsed.error?.issues[0]?.message ?? 'Enter a positive quantity and a unit cost.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const created = await requestOpeningStock(authorizedRequest, parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'opening'] });
      setSuccess(`Opening-stock request ${created.actionNo} submitted for approval.`);
      setQuantity('');
      setReference('');
      setSerials('');
    } catch (cause) {
      if (!(cause instanceof ApiRequestError) || cause.status >= 500) {
        setUncertain(true);
        setError(
          canRead
            ? 'The result is uncertain. Check opening-stock history before making another request.'
            : 'The result is uncertain. Ask an authorised request reader to check history before making another request.',
        );
      } else {
        setError(cause.message);
      }
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
      () => rejectOpeningStock(authorizedRequest, rejecting.id, parsed.data.reason),
      'Opening-stock request rejected.',
    );
  }

  return (
    <>
      <PageHeader
        title="Opening stock"
        description="Record starting stock through a reviewed request before it enters the FIFO ledger."
      />
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {success}
        </p>
      )}
      {canRequest && (
        <div className="mb-5">
          <Card title="Request opening stock">
            <p className="mb-4 text-sm text-slate-600">
              This creates a request. Stock changes only after approval and posting. Cost is in
              cents per base unit.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <StockItemSelect value={item} onChange={setItem} />
              <StockLocationSelect
                id="opening-location"
                label="Location"
                value={locationId}
                onChange={setLocationId}
              />
            </div>
            <form
              onSubmit={(event) => void submitRequest(event)}
              className="mt-4 grid gap-4 sm:max-w-xl"
            >
              <label className="text-sm font-medium text-slate-700">
                Quantity in {item?.baseUnit ?? 'base units'}
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Unit cost (cents)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  required
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Source reference
                <input
                  type="text"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  maxLength={80}
                  required
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Receipt date (optional, UTC)
                <input
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              {item?.trackSerial && (
                <label className="text-sm font-medium text-slate-700">
                  Serial numbers (one per line)
                  <textarea
                    value={serials}
                    onChange={(event) => setSerials(event.target.value)}
                    rows={4}
                    required
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={busy || uncertain}
                className="w-fit rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Submitting…' : 'Submit opening request'}
              </button>
            </form>
          </Card>
        </div>
      )}
      {rejecting && (
        <div className="mb-5">
          <Card title={`Reject ${rejecting.actionNo}`}>
            <form onSubmit={submitRejection} className="grid gap-3 sm:max-w-xl">
              <label className="text-sm font-medium text-slate-700">
                Rejection reason
                <textarea
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  maxLength={500}
                  required
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Reject request
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejecting(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {canRead && (
        <Card title="Opening-stock requests">
          <label htmlFor="opening-status" className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="opening-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as OpeningStatus | '')}
            className="mb-4 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {history.isPending ? (
            <p role="status">Loading requests…</p>
          ) : history.isError ? (
            <p role="alert">
              Could not load opening-stock requests.{' '}
              <button type="button" onClick={() => void history.refetch()} className="underline">
                Retry
              </button>
            </p>
          ) : history.data.pages[0]?.length === 0 ? (
            <p>No opening-stock requests match this status.</p>
          ) : (
            <>
              <div className="space-y-3">
                {history.data.pages.flat().map((record) => (
                  <section key={record.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {record.actionNo} · {record.payload.quantity} at {record.payload.unitCost}{' '}
                          cents
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
                    <p className="mt-1 break-all text-xs text-slate-500">
                      Item {record.payload.itemId} · Location {record.payload.locationId}
                    </p>
                    {record.rejectionReason && (
                      <p className="mt-2 text-sm text-red-700">
                        Rejected: {record.rejectionReason}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.status === 'PENDING_APPROVAL' &&
                        canApprove &&
                        (user?.id !== record.requestedBy || user?.permissions.includes('*')) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(
                                () => approveOpeningStock(authorizedRequest, record.id),
                                'Opening-stock request approved.',
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                          >
                            Approve
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
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
                        >
                          Reject
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
                                () => postOpeningStockRequest(authorizedRequest, record.id),
                                'Opening stock posted.',
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                          >
                            Post opening stock
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
                  className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  {history.isFetchingNextPage ? 'Loading…' : 'Load earlier requests'}
                </button>
              )}
            </>
          )}
        </Card>
      )}
      <div className="mt-5">
        <OpeningImportWizard />
      </div>
    </>
  );
}
