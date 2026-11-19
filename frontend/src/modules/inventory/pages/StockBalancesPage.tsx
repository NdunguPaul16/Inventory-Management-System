import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Card, PageHeader } from '../../../components/Card';
import { formatDateTime } from '../../../lib/format';
import { useAuth } from '../../auth/auth-context';
import { BALANCE_PAGE_SIZE, getBalances } from '../api/balances';

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' });

export function StockBalancesPage() {
  const { authorizedRequest } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [locationCodeInput, setLocationCodeInput] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const balances = useQuery({
    queryKey: ['inventory', 'balances', search, locationCode, before],
    queryFn: ({ signal }) =>
      getBalances(authorizedRequest, signal, {
        q: search,
        locationCode,
        before,
      }),
    retry: false,
  });

  const visible = balances.data ?? [];
  const totalValue = visible.reduce((sum, balance) => sum + balance.value, 0);
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setLocationCode(locationCodeInput.trim().toUpperCase());
    setCursors([]);
  }

  return (
    <>
      <PageHeader
        title="Stock balances"
        description="On-hand quantities and FIFO value by item and location."
      />
      <Card>
        <form onSubmit={submitSearch} className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="balance-search"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Search stock
            </label>
            <input
              id="balance-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="SKU, item or location"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label
              htmlFor="balance-location-code"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Location code
            </label>
            <input
              id="balance-location-code"
              type="text"
              value={locationCodeInput}
              onChange={(event) => setLocationCodeInput(event.target.value)}
              placeholder="Exact code, or leave blank"
              maxLength={80}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            Search all balances
          </button>
        </form>
        {balances.isPending ? (
          <p role="status" className="py-10 text-center text-sm text-slate-500">
            Loading stock balances…
          </p>
        ) : balances.isError ? (
          <div role="alert" className="py-10 text-center text-sm text-red-700">
            Could not load stock balances.{' '}
            <button
              type="button"
              onClick={() => void balances.refetch()}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No stock balances match this page or filter.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[750px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="pb-3 pr-4">
                      Item
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Location
                    </th>
                    <th scope="col" className="pb-3 pr-4 text-right">
                      On hand
                    </th>
                    <th scope="col" className="pb-3 pr-4 text-right">
                      Reserved
                    </th>
                    <th scope="col" className="pb-3 pr-4 text-right">
                      FIFO value
                    </th>
                    <th scope="col" className="pb-3">
                      Last movement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((balance) => (
                    <tr key={balance._id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4">
                        <Link
                          to={`/inventory/items/${balance.itemId._id}/stock?locationId=${balance.locationId._id}`}
                          className="block font-medium text-blue-700 hover:underline"
                        >
                          {balance.itemId.sku}
                        </Link>
                        <span className="text-xs text-slate-500">{balance.itemId.name}</span>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        {balance.locationId.code} — {balance.locationId.name}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {balance.onHand.$numberDecimal} {balance.itemId.baseUnit}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {balance.reserved.$numberDecimal} {balance.itemId.baseUnit}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {money.format(balance.value / 100)}
                      </td>
                      <td className="py-3 text-slate-600">
                        {balance.lastMovementAt ? formatDateTime(balance.lastMovementAt) : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <p>
                {visible.length} balances on this page · FIFO value {money.format(totalValue / 100)}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCursors(cursors.slice(0, -1))}
                  disabled={cursors.length === 0 || balances.isFetching}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span>Page {cursors.length + 1}</span>
                <button
                  type="button"
                  onClick={() => {
                    const last = visible.at(-1);
                    if (last) setCursors([...cursors, last._id]);
                  }}
                  disabled={visible.length < BALANCE_PAGE_SIZE || balances.isFetching}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
