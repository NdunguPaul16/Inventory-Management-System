import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { objectIdSchema } from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import { BALANCE_PAGE_SIZE, getBalances } from '../api/balances';
import { getItemLayers, getItemMovements, LAYER_PAGE_SIZE } from '../api/stock-detail';

type Tab = 'stock' | 'layers' | 'movements';
const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' });

function QueryError({ retry }: { retry: () => void }) {
  return (
    <p role="alert" className="py-8 text-sm text-red-700">
      Could not load stock details.{' '}
      <button type="button" onClick={retry} className="font-medium underline">
        Retry
      </button>
    </p>
  );
}

export function ItemStockPage() {
  const { itemId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, authorizedRequest } = useAuth();
  const validItemId = itemId && objectIdSchema.safeParse(itemId).success ? itemId : undefined;
  const canViewLayers = Boolean(user && canAccess(user, 'inventory.layers.read'));
  const canViewMovements = Boolean(user && canAccess(user, 'inventory.movements.read'));
  const [tab, setTab] = useState<Tab>('stock');
  const requestedLocationId = searchParams.get('locationId');
  const balances = useInfiniteQuery({
    queryKey: ['inventory', 'balances', validItemId],
    queryFn: ({ signal, pageParam }) => {
      if (!validItemId) throw new Error('Invalid item id');
      return getBalances(authorizedRequest, signal, { itemId: validItemId, before: pageParam });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === BALANCE_PAGE_SIZE ? lastPage.at(-1)?._id : undefined,
    enabled: Boolean(validItemId),
    retry: false,
  });
  const loadedBalances = useMemo(() => balances.data?.pages.flat() ?? [], [balances.data]);
  const selectedBalance = useQuery({
    queryKey: ['inventory', 'balance', validItemId, requestedLocationId],
    queryFn: ({ signal }) => {
      if (!validItemId || !requestedLocationId) throw new Error('Item and location are required');
      return getBalances(authorizedRequest, signal, {
        itemId: validItemId,
        locationId: requestedLocationId,
        limit: 1,
      });
    },
    enabled: Boolean(
      validItemId &&
      requestedLocationId &&
      balances.isSuccess &&
      !loadedBalances.some((balance) => balance.locationId._id === requestedLocationId),
    ),
    retry: false,
  });
  const balanceRows = useMemo(() => {
    const selected = selectedBalance.data?.[0];
    return selected && !loadedBalances.some((balance) => balance._id === selected._id)
      ? [...loadedBalances, selected]
      : loadedBalances;
  }, [loadedBalances, selectedBalance.data]);
  const locationId =
    balanceRows.find((balance) => balance.locationId._id === requestedLocationId)?.locationId._id ??
    balanceRows[0]?.locationId._id;
  const layers = useInfiniteQuery({
    queryKey: ['inventory', 'layers', validItemId, locationId],
    queryFn: ({ signal, pageParam }) => {
      if (!validItemId || !locationId) throw new Error('Item and location are required');
      return getItemLayers(authorizedRequest, validItemId, locationId, signal, pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === LAYER_PAGE_SIZE ? lastPage.at(-1)?._id : undefined,
    enabled: Boolean(validItemId && locationId && canViewLayers && tab === 'layers'),
    retry: false,
  });
  const movements = useInfiniteQuery({
    queryKey: ['inventory', 'movements', validItemId, locationId],
    queryFn: ({ signal, pageParam }) => {
      if (!validItemId || !locationId) throw new Error('Item and location are required');
      return getItemMovements(authorizedRequest, validItemId, locationId, signal, pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.length === 50 ? lastPage.at(-1)?._id : undefined),
    enabled: Boolean(validItemId && locationId && canViewMovements && tab === 'movements'),
    retry: false,
  });
  const item = balanceRows[0]?.itemId;

  if (!validItemId)
    return <PageHeader title="Invalid item" description="Choose an item from stock balances." />;

  return (
    <>
      <Link
        to="/inventory/balances"
        className="mb-4 inline-block text-sm font-medium text-blue-700 hover:underline"
      >
        ← Stock balances
      </Link>
      <PageHeader
        title={item ? `${item.sku} — ${item.name}` : 'Item stock'}
        description="Stock by location, FIFO cost layers and recent movements."
      />
      {balances.isPending ? (
        <Card>
          <p role="status" className="py-8 text-sm text-slate-600">
            Loading item stock…
          </p>
        </Card>
      ) : balances.isError ? (
        <Card>
          <QueryError retry={() => void balances.refetch()} />
        </Card>
      ) : balanceRows.length === 0 ? (
        <Card>
          <p className="py-8 text-sm text-slate-600">No posted stock balances for this item.</p>
        </Card>
      ) : (
        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div role="tablist" aria-label="Item stock details" className="flex flex-wrap gap-2">
              {(
                [
                  ['stock', 'Stock', true],
                  ['layers', 'FIFO layers', canViewLayers],
                  ['movements', 'Movements', canViewMovements],
                ] as const
              )
                .filter(([, , allowed]) => allowed)
                .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === value ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {tab !== 'stock' && (
              <div>
                <label
                  htmlFor="item-stock-location"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Location
                </label>
                <select
                  id="item-stock-location"
                  value={locationId}
                  onChange={(event) => setSearchParams({ locationId: event.target.value })}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {balanceRows.map((balance) => (
                    <option key={balance.locationId._id} value={balance.locationId._id}>
                      {balance.locationId.code} — {balance.locationId.name}
                    </option>
                  ))}
                </select>
                {balances.hasNextPage && (
                  <button
                    type="button"
                    onClick={() => void balances.fetchNextPage()}
                    disabled={balances.isFetchingNextPage}
                    className="ml-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                  >
                    {balances.isFetchingNextPage ? 'Loading…' : 'Load more locations'}
                  </button>
                )}
              </div>
            )}
          </div>
          {tab === 'stock' && (
            <div className="overflow-x-auto">
              <table className="min-w-[600px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="pb-3">
                      Location
                    </th>
                    <th scope="col" className="pb-3 text-right">
                      On hand
                    </th>
                    <th scope="col" className="pb-3 text-right">
                      Reserved
                    </th>
                    <th scope="col" className="pb-3 text-right">
                      FIFO value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((balance) => (
                    <tr key={balance._id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3">
                        {balance.locationId.code} — {balance.locationId.name}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {balance.onHand.$numberDecimal} {balance.itemId.baseUnit}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {balance.reserved.$numberDecimal} {balance.itemId.baseUnit}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {money.format(balance.value / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {balances.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void balances.fetchNextPage()}
                  disabled={balances.isFetchingNextPage}
                  className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {balances.isFetchingNextPage ? 'Loading…' : 'Load more locations'}
                </button>
              )}
            </div>
          )}
          {tab === 'layers' &&
            canViewLayers &&
            (layers.isPending ? (
              <p role="status" className="py-8 text-sm text-slate-600">
                Loading FIFO layers…
              </p>
            ) : layers.isError ? (
              <QueryError retry={() => void layers.refetch()} />
            ) : layers.data.pages[0]?.length === 0 ? (
              <p className="py-8 text-sm text-slate-600">No FIFO layers at this location.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[700px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="pb-3">
                        Received
                      </th>
                      <th scope="col" className="pb-3">
                        Source
                      </th>
                      <th scope="col" className="pb-3 text-right">
                        Original qty
                      </th>
                      <th scope="col" className="pb-3 text-right">
                        Remaining qty
                      </th>
                      <th scope="col" className="pb-3 text-right">
                        Remaining value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {layers.data.pages.flat().map((layer) => (
                      <tr key={layer._id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3">{formatDateTime(layer.receivedAt)}</td>
                        <td className="py-3">{layer.sourceDoc.number}</td>
                        <td className="py-3 text-right tabular-nums">
                          {layer.originalQty.$numberDecimal}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {layer.remainingQty.$numberDecimal}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {layer.remainingValue === undefined
                            ? 'Unavailable'
                            : money.format(layer.remainingValue / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {layers.hasNextPage && (
                  <button
                    type="button"
                    onClick={() => void layers.fetchNextPage()}
                    disabled={layers.isFetchingNextPage}
                    className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                  >
                    {layers.isFetchingNextPage ? 'Loading…' : 'Load later FIFO layers'}
                  </button>
                )}
              </div>
            ))}
          {tab === 'movements' &&
            canViewMovements &&
            (movements.isPending ? (
              <p role="status" className="py-8 text-sm text-slate-600">
                Loading movements…
              </p>
            ) : movements.isError ? (
              <QueryError retry={() => void movements.refetch()} />
            ) : movements.data.pages[0]?.length === 0 ? (
              <p className="py-8 text-sm text-slate-600">No movements at this location.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[700px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="pb-3">
                        Posted
                      </th>
                      <th scope="col" className="pb-3">
                        Movement
                      </th>
                      <th scope="col" className="pb-3">
                        Source
                      </th>
                      <th scope="col" className="pb-3 text-right">
                        Quantity
                      </th>
                      <th scope="col" className="pb-3 text-right">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.data.pages.flat().map((movement) => (
                      <tr key={movement._id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3">{formatDateTime(movement.postedAt)}</td>
                        <td className="py-3">
                          {movement.movementNo} · {movement.movementType}
                        </td>
                        <td className="py-3">{movement.sourceDoc.number}</td>
                        <td className="py-3 text-right tabular-nums">
                          {movement.direction === 'OUT' ? '−' : '+'}
                          {movement.quantity.$numberDecimal}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          {money.format(movement.totalCost / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {movements.hasNextPage && (
                  <button
                    type="button"
                    onClick={() => void movements.fetchNextPage()}
                    disabled={movements.isFetchingNextPage}
                    className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                  >
                    {movements.isFetchingNextPage ? 'Loading…' : 'Load earlier movements'}
                  </button>
                )}
              </div>
            ))}
        </Card>
      )}
    </>
  );
}
