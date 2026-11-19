import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import {
  getStockItemOptions,
  getStockLocationOptions,
  type StockItemOption,
} from '../api/references';

export function StockItemSelect({
  value,
  onChange,
}: {
  value: StockItemOption | null;
  onChange: (item: StockItemOption | null) => void;
}) {
  const { authorizedRequest } = useAuth();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const items = useQuery({
    queryKey: ['inventory', 'reference-items', search],
    queryFn: ({ signal }) => getStockItemOptions(authorizedRequest, search, signal),
    retry: false,
  });
  return (
    <div>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onChange(null);
          setSearch(draft.trim());
        }}
      >
        <label htmlFor="stock-item-search" className="sr-only">
          Search stocked items
        </label>
        <input
          id="stock-item-search"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search SKU or item"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          Search
        </button>
      </form>
      <label htmlFor="stock-item-select" className="mb-1 block text-sm font-medium text-slate-700">
        Item
      </label>
      <select
        id="stock-item-select"
        value={value?.id ?? ''}
        disabled={items.isPending || items.isError}
        onChange={(event) =>
          onChange(items.data?.find((item) => item.id === event.target.value) ?? null)
        }
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
          <button type="button" onClick={() => void items.refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
      {items.data?.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">No matching active stocked items.</p>
      )}
    </div>
  );
}

export function StockLocationSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { authorizedRequest } = useAuth();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const locations = useQuery({
    queryKey: ['inventory', 'reference-locations', search],
    queryFn: ({ signal }) => getStockLocationOptions(authorizedRequest, search, signal),
    retry: false,
  });
  return (
    <div>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onChange('');
          setSearch(draft.trim());
        }}
      >
        <label htmlFor={`${id}-search`} className="sr-only">
          Search {label.toLowerCase()}
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search location"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          Search
        </button>
      </form>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={locations.isPending || locations.isError}
        onChange={(event) => onChange(event.target.value)}
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
          <button type="button" onClick={() => void locations.refetch()} className="underline">
            Retry
          </button>
        </p>
      )}
      {locations.data?.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">No matching active locations.</p>
      )}
    </div>
  );
}
