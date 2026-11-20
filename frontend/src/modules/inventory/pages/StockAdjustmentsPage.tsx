import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import {
  adjustmentSchema,
  isSystemStockApprover,
  rejectStockActionSchema,
  type AdjustmentInput,
} from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { ApiRequestError } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import {
  approveAdjustment,
  listAdjustments,
  postAdjustment,
  rejectAdjustment,
  requestAdjustment,
  type AdjustmentRecord,
  type AdjustmentStatus,
} from '../api/adjustments';
import type { StockItemOption } from '../api/references';
import { StockItemSelect, StockLocationSelect } from '../components/StockReferenceSelect';

const PAGE_SIZE = 20;
const statuses: AdjustmentStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'];

function serialList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((serial) => serial.trim())
    .filter(Boolean);
}

function tone(status: AdjustmentStatus) {
  if (status === 'POSTED') return 'success' as const;
  if (status === 'REJECTED') return 'danger' as const;
  if (status === 'PENDING_APPROVAL') return 'warning' as const;
  return 'neutral' as const;
}

export function StockAdjustmentsPage() {
  const { user, authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [item, setItem] = useState<StockItemOption | null>(null);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [serials, setSerials] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdjustmentStatus | ''>('');
  const [rejecting, setRejecting] = useState<AdjustmentRecord | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const canRequest = Boolean(user && canAccess(user, 'inventory.adjustments.request'));
  const canRead = Boolean(user && canAccess(user, 'inventory.requests.read'));
  const canApprove = Boolean(
    user && isSystemStockApprover(user) && canAccess(user, 'inventory.adjustments.approve'),
  );
  const canPost = Boolean(
    user && isSystemStockApprover(user) && canAccess(user, 'inventory.adjustments.post'),
  );
  const adjustments = useInfiniteQuery({
    queryKey: ['inventory', 'adjustments', statusFilter],
    queryFn: ({ pageParam, signal }) =>
      listAdjustments(authorizedRequest, statusFilter || undefined, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.id : undefined,
    retry: false,
    enabled: canRead,
  });

  async function runAction(action: () => Promise<unknown>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'adjustments'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'balances'] });
      setRejecting(null);
      setSuccess(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The adjustment action failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || uncertain) return;
    setError(null);
    setSuccess(null);
    if (!item || !locationId) {
      setError('Select an item and location.');
      return;
    }
    const normalizedQuantity = quantity.trim();
    if (/^0+(?:\.0+)?$/.test(normalizedQuantity)) {
      setError('Quantity must be greater than zero.');
      return;
    }
    if (direction === 'IN' && unitCost.trim() === '') {
      setError('An inbound adjustment needs a unit cost in cents.');
      return;
    }
    const input: AdjustmentInput = {
      itemId: item.id,
      locationId,
      quantity: normalizedQuantity,
      direction,
      reason,
      sourceDoc: {
        type: 'ADJUSTMENT_REQUEST',
        id: globalThis.crypto.randomUUID(),
        number: reference.trim(),
      },
      ...(direction === 'IN' ? { unitCost: Number(unitCost) } : {}),
      ...(item.trackSerial ? { serialNumbers: serialList(serials) } : {}),
    };
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter valid adjustment details.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const created = await requestAdjustment(authorizedRequest, parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'adjustments'] });
      setSuccess(`Adjustment request ${created.actionNo} submitted for approval.`);
      setQuantity('');
      setReference('');
      setReason('');
      setSerials('');
    } catch (cause) {
      if (!(cause instanceof ApiRequestError) || cause.status >= 500) {
        setUncertain(true);
        setError(
          canRead
            ? 'The request result is uncertain. Check adjustment history before submitting another request.'
            : 'The request result is uncertain. Ask an authorised request reader to check history before submitting another request.',
        );
      } else {
        setError(cause.message);
      }
    } finally {
      busyRef.current = false;
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
      () => rejectAdjustment(authorizedRequest, rejecting.id, parsed.data.reason),
      'Adjustment rejected.',
    );
  }

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        description="Request a correction, then have a separate authorised user approve and post it."
      />
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </p>
      )}
      {canRequest && (
        <div className="mb-5">
          <Card title="Request an adjustment">
            <p className="mb-4 text-sm text-slate-600">
              Requests do not change stock until approved and posted. Inbound requests need a cost
              per base unit.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <StockItemSelect value={item} onChange={setItem} />
              <StockLocationSelect
                id="adjustment-location"
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
                Direction
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as 'IN' | 'OUT')}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="IN">Add stock</option>
                  <option value="OUT">Remove stock</option>
                </select>
              </label>
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
              {direction === 'IN' && (
                <label className="text-sm font-medium text-slate-700">
                  Inbound unit cost (cents)
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
              )}
              <label className="text-sm font-medium text-slate-700">
                Reference
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
                Reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  required
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
                {busy ? 'Submitting…' : 'Submit request'}
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
                  Reject adjustment
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
        <Card title="Adjustment requests">
          <div className="mb-4 sm:max-w-xs">
            <label
              htmlFor="adjustment-status"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Status
            </label>
            <select
              id="adjustment-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as AdjustmentStatus | '')}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          {adjustments.isPending ? (
            <p role="status" className="py-8 text-sm text-slate-600">
              Loading adjustments…
            </p>
          ) : adjustments.isError ? (
            <p role="alert" className="py-8 text-sm text-red-700">
              Could not load adjustments.{' '}
              <button
                type="button"
                onClick={() => void adjustments.refetch()}
                className="underline"
              >
                Retry
              </button>
            </p>
          ) : adjustments.data.pages[0]?.length === 0 ? (
            <p className="py-8 text-sm text-slate-600">No adjustment requests match this status.</p>
          ) : (
            <>
              <div className="space-y-3">
                {adjustments.data.pages.flat().map((record) => (
                  <section key={record.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {record.actionNo} · {record.payload.direction} {record.payload.quantity}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {record.payload.sourceDoc.number} · {formatDateTime(record.createdAt)}
                        </p>
                      </div>
                      <StatusBadge tone={tone(record.status)}>
                        {record.status.replaceAll('_', ' ')}
                      </StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{record.payload.reason}</p>
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
                        user?.id !== record.requestedBy && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(
                                () => approveAdjustment(authorizedRequest, record.id),
                                'Adjustment approved.',
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
                                () => postAdjustment(authorizedRequest, record.id),
                                'Adjustment posted.',
                              )
                            }
                            className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                          >
                            Post adjustment
                          </button>
                        )}
                    </div>
                  </section>
                ))}
              </div>
              {adjustments.hasNextPage && (
                <button
                  type="button"
                  disabled={adjustments.isFetchingNextPage}
                  onClick={() => void adjustments.fetchNextPage()}
                  className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  {adjustments.isFetchingNextPage ? 'Loading…' : 'Load earlier requests'}
                </button>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}
