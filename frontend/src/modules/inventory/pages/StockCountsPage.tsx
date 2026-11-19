import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import {
  enterSerialStockCountSchema,
  enterStockCountSchema,
  rejectStockCountSchema,
} from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import {
  approveCount,
  enterCount,
  enterSerialCount,
  freezeCount,
  getCountItems,
  getCountLocations,
  getCounts,
  postCount,
  rejectCount,
  type CountRecord,
  type CountStatus,
} from '../api/counts';

const PAGE_SIZE = 20;
const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' });
const statuses: CountStatus[] = ['FROZEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'];

function countTone(status: CountStatus) {
  if (status === 'POSTED') return 'success' as const;
  if (status === 'REJECTED') return 'danger' as const;
  if (status === 'PENDING_APPROVAL') return 'warning' as const;
  return 'neutral' as const;
}

export function StockCountsPage() {
  const { user, authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CountStatus | ''>('');
  const [itemSearchDraft, setItemSearchDraft] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [locationSearchDraft, setLocationSearchDraft] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [editing, setEditing] = useState<{ kind: 'entry' | 'reject'; count: CountRecord } | null>(
    null,
  );
  const [countedQuantity, setCountedQuantity] = useState('');
  const [serialText, setSerialText] = useState('');
  const [inboundUnitCost, setInboundUnitCost] = useState('');
  const [reason, setReason] = useState('');

  const canFreeze = Boolean(user && canAccess(user, 'inventory.counts.freeze'));
  const canEnter = Boolean(user && canAccess(user, 'inventory.counts.enter'));
  const canApprove = Boolean(user && canAccess(user, 'inventory.counts.approve'));
  const canPost = Boolean(user && canAccess(user, 'inventory.counts.post'));
  const counts = useInfiniteQuery({
    queryKey: ['inventory', 'counts', statusFilter],
    queryFn: ({ pageParam, signal }) =>
      getCounts(authorizedRequest, statusFilter || undefined, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.id : undefined,
    retry: false,
  });
  const items = useQuery({
    queryKey: ['inventory', 'count-options', 'items', itemSearch],
    queryFn: ({ signal }) => getCountItems(authorizedRequest, itemSearch, signal),
    enabled: canFreeze,
    retry: false,
  });
  const locations = useQuery({
    queryKey: ['inventory', 'count-options', 'locations', locationSearch],
    queryFn: ({ signal }) => getCountLocations(authorizedRequest, locationSearch, signal),
    enabled: canFreeze,
    retry: false,
  });

  async function runAction(action: () => Promise<unknown>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'counts'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'balances'] });
      setEditing(null);
      setSuccess(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The stock count action failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function startEditing(kind: 'entry' | 'reject', count: CountRecord) {
    setEditing({ kind, count });
    setCountedQuantity(count.countedQuantity ?? '');
    setSerialText((count.countedSerialNumbers ?? count.bookSerialNumbers ?? []).join('\n'));
    setInboundUnitCost('');
    setReason('');
    setError(null);
    setSuccess(null);
  }

  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || editing.kind !== 'entry') return;
    if (editing.count.mode === 'SERIAL') {
      const parsedSerial = enterSerialStockCountSchema.safeParse({
        serialNumbers: serialText
          .split(/\r?\n/)
          .map((serial) => serial.trim())
          .filter(Boolean),
        reason,
        ...(inboundUnitCost.trim() ? { inboundUnitCost: Number(inboundUnitCost) } : {}),
      });
      if (!parsedSerial.success) {
        setError(parsedSerial.error.issues[0]?.message ?? 'Enter valid serial numbers.');
        return;
      }
      const normalized = parsedSerial.data.serialNumbers.map((serial) => serial.toUpperCase());
      if (new Set(normalized).size !== normalized.length) {
        setError('Serial numbers must be unique.');
        return;
      }
      const book = new Set(editing.count.bookSerialNumbers ?? []);
      const hasFoundSerial = normalized.some((serial) => !book.has(serial));
      if (hasFoundSerial && parsedSerial.data.inboundUnitCost === undefined) {
        setError('Inbound unit cost is required for found serials.');
        return;
      }
      if (!hasFoundSerial && parsedSerial.data.inboundUnitCost !== undefined) {
        setError('Inbound unit cost applies only to found serials.');
        return;
      }
      void runAction(
        () => enterSerialCount(authorizedRequest, editing.count.id, parsedSerial.data),
        'Serial count submitted for approval.',
      );
      return;
    }
    const parsed = enterStockCountSchema.safeParse({
      countedQuantity,
      reason,
      ...(inboundUnitCost.trim() ? { inboundUnitCost: Number(inboundUnitCost) } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid count.');
      return;
    }
    void runAction(
      () => enterCount(authorizedRequest, editing.count.id, parsed.data),
      'Count submitted for approval.',
    );
  }

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || editing.kind !== 'reject') return;
    const parsed = rejectStockCountSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a reason.');
      return;
    }
    void runAction(
      () => rejectCount(authorizedRequest, editing.count.id, parsed.data.reason),
      'Count rejected.',
    );
  }

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Freeze a book balance, enter a physical count, review the variance and post it through FIFO."
      />
      {success && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {canFreeze && (
        <div className="mb-5">
          <Card title="Start a count">
            <p className="mb-4 text-sm text-slate-600">
              Search active stocked items and locations. A count can start even when the current
              balance is zero.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setItemSearch(itemSearchDraft.trim());
                    setItemId('');
                  }}
                  className="mb-2 flex gap-2"
                >
                  <label htmlFor="count-item-search" className="sr-only">
                    Search count items
                  </label>
                  <input
                    id="count-item-search"
                    type="search"
                    value={itemSearchDraft}
                    onChange={(event) => setItemSearchDraft(event.target.value)}
                    placeholder="Search SKU or item"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    Search
                  </button>
                </form>
                <label
                  htmlFor="count-item"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Item
                </label>
                <select
                  id="count-item"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                  disabled={items.isPending || items.isError}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="">Select item</option>
                  {items.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                      {item.trackSerial ? ' (serial)' : ''}
                    </option>
                  ))}
                </select>
                {items.isError && (
                  <p role="alert" className="mt-1 text-xs text-red-700">
                    Could not load items.{' '}
                    <button
                      type="button"
                      onClick={() => void items.refetch()}
                      className="underline"
                    >
                      Retry
                    </button>
                  </p>
                )}
                {items.data?.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">No matching countable items.</p>
                )}
              </div>
              <div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setLocationSearch(locationSearchDraft.trim());
                    setLocationId('');
                  }}
                  className="mb-2 flex gap-2"
                >
                  <label htmlFor="count-location-search" className="sr-only">
                    Search count locations
                  </label>
                  <input
                    id="count-location-search"
                    type="search"
                    value={locationSearchDraft}
                    onChange={(event) => setLocationSearchDraft(event.target.value)}
                    placeholder="Search location"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    Search
                  </button>
                </form>
                <label
                  htmlFor="count-location"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Location
                </label>
                <select
                  id="count-location"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  disabled={locations.isPending || locations.isError}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="">Select location</option>
                  {locations.data?.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </select>
                {locations.isError && (
                  <p role="alert" className="mt-1 text-xs text-red-700">
                    Could not load locations.{' '}
                    <button
                      type="button"
                      onClick={() => void locations.refetch()}
                      className="underline"
                    >
                      Retry
                    </button>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              disabled={!itemId || !locationId || busy}
              onClick={() =>
                void runAction(
                  () => freezeCount(authorizedRequest, itemId, locationId),
                  'Book balance frozen for counting.',
                )
              }
              className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Freeze book balance
            </button>
          </Card>
        </div>
      )}

      {editing && (
        <div className="mb-5">
          <Card
            title={`${editing.kind === 'entry' ? 'Enter count' : 'Reject count'} · ${editing.count.countNo}`}
          >
            {editing.kind === 'entry' ? (
              <form onSubmit={submitEntry} className="grid gap-3 sm:max-w-xl">
                {editing.count.mode === 'SERIAL' ? (
                  <label className="text-sm font-medium text-slate-700">
                    Physical serial numbers, one per line
                    <textarea
                      value={serialText}
                      onChange={(event) => setSerialText(event.target.value)}
                      rows={8}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Book: {(editing.count.bookSerialNumbers ?? []).join(', ') || 'none'}. Enter
                      the serials physically present; leave blank when none remain.
                    </span>
                  </label>
                ) : (
                  <>
                    <p className="text-sm text-slate-600">
                      Frozen book quantity: {editing.count.bookQuantity}. Positive variances require
                      an inbound cost in cents per base unit.
                    </p>
                    <label className="text-sm font-medium text-slate-700">
                      Physical quantity
                      <input
                        type="text"
                        inputMode="decimal"
                        value={countedQuantity}
                        onChange={(event) => setCountedQuantity(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                        required
                      />
                    </label>
                  </>
                )}
                <label className="text-sm font-medium text-slate-700">
                  Inbound unit cost (cents,{' '}
                  {editing.count.mode === 'SERIAL'
                    ? 'for found serials'
                    : 'only for a positive variance'}
                  )
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={inboundUnitCost}
                    onChange={(event) => setInboundUnitCost(event.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Reason
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Submit count
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitRejection} className="grid gap-3 sm:max-w-xl">
                <label className="text-sm font-medium text-slate-700">
                  Rejection reason
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
                    required
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Reject count
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      <Card title="Count history">
        <div className="mb-4 sm:max-w-xs">
          <label
            htmlFor="count-status"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Status
          </label>
          <select
            id="count-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CountStatus | '')}
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
        {counts.isPending ? (
          <p role="status" className="py-8 text-sm text-slate-600">
            Loading stock counts…
          </p>
        ) : counts.isError ? (
          <p role="alert" className="py-8 text-sm text-red-700">
            Could not load stock counts.{' '}
            <button type="button" onClick={() => void counts.refetch()} className="underline">
              Retry
            </button>
          </p>
        ) : counts.data.pages[0]?.length === 0 ? (
          <p className="py-8 text-sm text-slate-600">No stock counts match this status.</p>
        ) : (
          <>
            <div className="space-y-3">
              {counts.data.pages.flat().map((count) => (
                <section key={count.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {count.countNo} · {count.item?.sku ?? count.itemId}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {count.item?.name ?? 'Item unavailable'} ·{' '}
                        {count.location?.code ?? count.locationId} · Frozen{' '}
                        {formatDateTime(count.frozenAt)}
                      </p>
                    </div>
                    <StatusBadge tone={countTone(count.status)}>
                      {count.status.replaceAll('_', ' ')}
                    </StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
                    <span>Book: {count.bookQuantity}</span>
                    <span>Counted: {count.countedQuantity ?? '—'}</span>
                    <span>Variance: {count.varianceQuantity ?? '—'}</span>
                    <span>Book value: {money.format(count.bookValue / 100)}</span>
                  </div>
                  {count.mode === 'SERIAL' && (
                    <details className="mt-2 text-sm text-slate-700">
                      <summary className="cursor-pointer font-medium">Serial count detail</summary>
                      <div className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 p-2">
                        <p>Book: {(count.bookSerialNumbers ?? []).join(', ') || 'none'}</p>
                        <p>
                          Counted:{' '}
                          {count.countedSerialNumbers === null
                            ? 'not entered'
                            : count.countedSerialNumbers.join(', ') || 'none'}
                        </p>
                        {count.countedSerialNumbers && (
                          <>
                            <p>
                              Missing:{' '}
                              {(count.bookSerialNumbers ?? [])
                                .filter((serial) => !count.countedSerialNumbers?.includes(serial))
                                .join(', ') || 'none'}
                            </p>
                            <p>
                              Found:{' '}
                              {count.countedSerialNumbers
                                .filter((serial) => !count.bookSerialNumbers?.includes(serial))
                                .join(', ') || 'none'}
                            </p>
                          </>
                        )}
                      </div>
                    </details>
                  )}
                  {count.rejectionReason && (
                    <p className="mt-2 text-sm text-red-700">Rejected: {count.rejectionReason}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {count.status === 'FROZEN' && canEnter && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startEditing('entry', count)}
                        className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 disabled:opacity-40"
                      >
                        Enter physical count
                      </button>
                    )}
                    {count.status === 'PENDING_APPROVAL' &&
                      canApprove &&
                      user?.id !== count.frozenBy &&
                      user?.id !== count.countedBy && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runAction(
                              () => approveCount(authorizedRequest, count.id),
                              'Count approved.',
                            )
                          }
                          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                      )}
                    {count.status === 'APPROVED' && canPost && user?.id === count.approvedBy && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(
                            () => postCount(authorizedRequest, count.id),
                            'Count variance posted.',
                          )
                        }
                        className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                      >
                        Post variance
                      </button>
                    )}
                    {['FROZEN', 'PENDING_APPROVAL', 'APPROVED'].includes(count.status) &&
                      canApprove && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEditing('reject', count)}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40"
                        >
                          Reject / cancel
                        </button>
                      )}
                  </div>
                </section>
              ))}
            </div>
            {counts.hasNextPage && (
              <button
                type="button"
                disabled={counts.isFetchingNextPage}
                onClick={() => void counts.fetchNextPage()}
                className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {counts.isFetchingNextPage ? 'Loading…' : 'Load earlier counts'}
              </button>
            )}
          </>
        )}
      </Card>
    </>
  );
}
