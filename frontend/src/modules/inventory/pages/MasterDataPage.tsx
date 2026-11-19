import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  createItemSchema,
  createLocationSchema,
  ITEM_TYPES,
  LOCATION_TYPES,
  updateItemSchema,
  updateLocationSchema,
} from '@ims/shared';
import { Card, PageHeader } from '../../../components/Card';
import { StatusBadge } from '../../../components/StatusBadge';
import { useAuth } from '../../auth/auth-context';
import { canAccess } from '../../auth/permissions';
import {
  createItem,
  createLocation,
  listItems,
  listLocations,
  updateItem,
  updateLocation,
  type ItemRecord,
  type LocationRecord,
} from '../api/master-data';

const PAGE_SIZE = 20;
type Kind = 'items' | 'locations';
type Record = ItemRecord | LocationRecord;
type Draft = {
  code: string;
  name: string;
  type: string;
  baseUnit: string;
  trackSerial: boolean;
  trackBatch: boolean;
  isActive: boolean;
};

function blankDraft(kind: Kind): Draft {
  return {
    code: '',
    name: '',
    type: kind === 'items' ? ITEM_TYPES[0] : LOCATION_TYPES[0],
    baseUnit: 'PCS',
    trackSerial: false,
    trackBatch: false,
    isActive: true,
  };
}

function recordDraft(record: Record): Draft {
  return {
    code: 'sku' in record ? record.sku : record.code,
    name: record.name,
    type: record.type,
    baseUnit: 'baseUnit' in record ? record.baseUnit : 'PCS',
    trackSerial: 'trackSerial' in record ? record.trackSerial : false,
    trackBatch: 'trackBatch' in record ? record.trackBatch : false,
    isActive: record.isActive,
  };
}

export function MasterDataPage({ kind }: { kind: Kind }) {
  const { user, authorizedRequest } = useAuth();
  const queryClient = useQueryClient();
  const label = kind === 'items' ? 'Items' : 'Locations';
  const canCreate = Boolean(user && canAccess(user, `inventory.${kind}.create`));
  const canUpdate = Boolean(user && canAccess(user, `inventory.${kind}.update`));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const queryKey = ['inventory', kind, search, status, before] as const;
  const recordsQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<Record[]> =>
      kind === 'items'
        ? await listItems(authorizedRequest, search, status, before, signal)
        : await listLocations(authorizedRequest, search, status, before, signal),
    retry: false,
  });
  const [editing, setEditing] = useState<Record | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(kind));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const records = recordsQuery.data ?? [];

  function openForm(record: Record | 'new') {
    setEditing(record);
    setDraft(record === 'new' ? blankDraft(kind) : recordDraft(record));
    setFormError(null);
    setSuccess(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setFormError(null);
    setBusy(true);
    try {
      if (kind === 'items') {
        const value = {
          sku: draft.code,
          name: draft.name,
          type: draft.type,
          baseUnit: draft.baseUnit,
          trackSerial: draft.trackSerial,
          trackBatch: draft.trackBatch,
        };
        if (editing === 'new') {
          const parsed = createItemSchema.parse(value);
          await createItem(authorizedRequest, parsed);
        } else {
          const parsed = updateItemSchema.parse({ ...value, isActive: draft.isActive });
          await updateItem(authorizedRequest, editing.id, parsed);
        }
      } else {
        const value = { code: draft.code, name: draft.name, type: draft.type };
        if (editing === 'new') {
          const parsed = createLocationSchema.parse(value);
          await createLocation(authorizedRequest, parsed);
        } else {
          const parsed = updateLocationSchema.parse({ ...value, isActive: draft.isActive });
          await updateLocation(authorizedRequest, editing.id, parsed);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['inventory', kind] });
      setCursors([]);
      setEditing(null);
      setSuccess(`${kind === 'items' ? 'Item' : 'Location'} saved.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={label}
          description={
            kind === 'items'
              ? 'Manage stock item identities and tracking.'
              : 'Manage stock locations.'
          }
        />
        {canCreate && (
          <button
            type="button"
            onClick={() => openForm('new')}
            className="mb-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Create {kind === 'items' ? 'item' : 'location'}
          </button>
        )}
      </div>
      {success && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {success}
        </p>
      )}
      {editing && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            {editing === 'new' ? 'Create' : 'Edit'} {kind === 'items' ? 'item' : 'location'}
          </h2>
          <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              {kind === 'items' ? 'SKU' : 'Code'}
              <input
                required
                maxLength={80}
                value={draft.code}
                onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Name
              <input
                required
                minLength={2}
                maxLength={160}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Type
              <select
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {(kind === 'items' ? ITEM_TYPES : LOCATION_TYPES).map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'items' && (
              <label className="text-sm font-medium text-slate-700">
                Base unit
                <input
                  required
                  maxLength={80}
                  value={draft.baseUnit}
                  onChange={(event) => setDraft({ ...draft, baseUnit: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            )}
            {kind === 'items' && (
              <div className="flex flex-wrap items-center gap-5 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.trackSerial}
                    onChange={(event) => setDraft({ ...draft, trackSerial: event.target.checked })}
                  />
                  Track serial numbers
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.trackBatch}
                    onChange={(event) => setDraft({ ...draft, trackBatch: event.target.checked })}
                  />
                  Track batches
                </label>
              </div>
            )}
            {editing !== 'new' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                />
                Active
              </label>
            )}
            {formError && (
              <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                {formError}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
            setCursors([]);
          }}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <label className="flex-1 text-sm font-medium text-slate-700">
            Search {label.toLowerCase()}
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setCursors([]);
              }}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
          >
            Search
          </button>
        </form>
        {recordsQuery.isPending ? (
          <p role="status" className="py-8 text-center text-sm text-slate-500">
            Loading {label.toLowerCase()}…
          </p>
        ) : recordsQuery.isError ? (
          <p role="alert" className="py-8 text-center text-sm text-red-700">
            Could not load {label.toLowerCase()}.{' '}
            <button type="button" onClick={() => void recordsQuery.refetch()} className="underline">
              Retry
            </button>
          </p>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No {label.toLowerCase()} found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th scope="col" className="pb-3">
                    {kind === 'items' ? 'SKU' : 'Code'}
                  </th>
                  <th scope="col" className="pb-3">
                    Name
                  </th>
                  <th scope="col" className="pb-3">
                    Type
                  </th>
                  <th scope="col" className="pb-3">
                    Status
                  </th>
                  <th scope="col" className="pb-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100">
                    <td className="py-3 font-medium">
                      {'sku' in record ? record.sku : record.code}
                    </td>
                    <td className="py-3">{record.name}</td>
                    <td className="py-3">{record.type.replaceAll('_', ' ')}</td>
                    <td className="py-3">
                      <StatusBadge tone={record.isActive ? 'success' : 'neutral'}>
                        {record.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      {canUpdate && (
                        <button
                          type="button"
                          onClick={() => openForm(record)}
                          className="font-medium text-blue-700 hover:underline"
                          aria-label={`Edit ${record.name}`}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
          <span>Page {cursors.length + 1}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cursors.length === 0 || recordsQuery.isFetching}
              onClick={() => setCursors(cursors.slice(0, -1))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={records.length < PAGE_SIZE || recordsQuery.isFetching}
              onClick={() => {
                const last = records.at(-1);
                if (last) setCursors([...cursors, last.id]);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
