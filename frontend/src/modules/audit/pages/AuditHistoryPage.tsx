import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Card, PageHeader } from '../../../components/Card';
import { useAuth } from '../../auth/auth-context';
import { getAuditEvent, getAuditHistory } from '../api/audit';

const FILTERS = ['action', 'entity', 'entityId', 'user', 'from', 'to'] as const;

function initialFilters(params: URLSearchParams) {
  return {
    action: params.get('action') ?? '',
    entity: params.get('entity') ?? '',
    entityId: params.get('entityId') ?? '',
    user: params.get('user') ?? '',
    from: params.get('from')?.slice(0, 10) ?? '',
    to: params.get('to')?.slice(0, 10) ?? '',
  };
}

function displayTime(iso: string) {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200';

export function AuditHistoryPage() {
  const { authorizedRequest } = useAuth();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => initialFilters(params));
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filterKey = params.toString();
  const cursor = cursors[page] ?? null;
  const historyQuery = useQuery({
    queryKey: ['audit-history', filterKey, cursor],
    queryFn: ({ signal }) => getAuditHistory(authorizedRequest, params, cursor, signal),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const detailQuery = useQuery({
    queryKey: ['audit-event', selectedId],
    queryFn: ({ signal }) => getAuditEvent(authorizedRequest, selectedId!, signal),
    enabled: Boolean(selectedId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const key of FILTERS) {
      const value = draft[key].trim();
      if (value)
        next.set(
          key,
          key === 'from'
            ? `${value}T00:00:00.000Z`
            : key === 'to'
              ? `${value}T23:59:59.999Z`
              : value,
        );
    }
    setParams(next);
    setCursors([null]);
    setPage(0);
    setSelectedId(null);
  }

  function clearFilters() {
    setDraft(initialFilters(new URLSearchParams()));
    setParams(new URLSearchParams());
    setCursors([null]);
    setPage(0);
    setSelectedId(null);
  }

  function nextPage() {
    const next = historyQuery.data?.meta.nextCursor;
    if (!next) return;
    setCursors((previous) => [...previous.slice(0, page + 1), next]);
    setPage((previous) => previous + 1);
    setSelectedId(null);
  }

  return (
    <>
      <PageHeader title="Audit History" description="Review recorded activity and access events." />
      <Card title="Search audit history">
        <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(
            [
              ['action', 'Action (exact match)'],
              ['entity', 'Entity type'],
              ['entityId', 'Entity ID'],
              ['user', 'Actor or affected user ID'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm font-medium text-slate-700">
              {label}
              <input
                className={`${inputClass} mt-1`}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          {(['from', 'to'] as const).map((key) => (
            <label key={key} className="block text-sm font-medium text-slate-700">
              {key === 'from' ? 'From (UTC date)' : 'To (UTC date)'}
              <input
                type="date"
                className={`${inputClass} mt-1`}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Search
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </form>
      </Card>

      <div className="mt-5">
        <Card title="Events">
          {historyQuery.isPending ? (
            <p role="status" className="py-8 text-center text-sm text-slate-600">
              Loading audit history…
            </p>
          ) : historyQuery.isError ? (
            <p role="alert" className="py-8 text-center text-sm text-red-700">
              {historyQuery.error instanceof Error
                ? historyQuery.error.message
                : 'Could not load audit history.'}{' '}
              <button
                type="button"
                onClick={() => void historyQuery.refetch()}
                className="font-medium underline"
              >
                Retry
              </button>
            </p>
          ) : historyQuery.data.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-600">
              No audit events match this range or filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-3 pr-4">Time (Nairobi)</th>
                    <th className="pb-3 pr-4">Action</th>
                    <th className="pb-3 pr-4">Affected entity</th>
                    <th className="pb-3 pr-4">Actor</th>
                    <th className="pb-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.data.map((event) => (
                    <tr key={event.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <time dateTime={event.at} title={event.at}>
                          {displayTime(event.at)}
                        </time>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-medium text-slate-900">{event.action}</span>
                        <span className="block text-xs text-slate-500">{event.summary}</span>
                      </td>
                      <td className="py-3 pr-4">
                        {event.entityType} · {event.entityId}
                      </td>
                      <td className="py-3 pr-4">{event.actorId ?? 'Unverified / system'}</td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(event.id)}
                          className="font-medium text-blue-700 hover:underline"
                          aria-label={`View event ${event.id}`}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-600">
            <span>Page {page + 1}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => {
                  setPage(page - 1);
                  setSelectedId(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!historyQuery.data?.meta.hasMore}
                onClick={nextPage}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      </div>

      {selectedId && (
        <div className="mt-5">
          <Card
            title="Event details"
            actions={
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-sm text-blue-700 hover:underline"
              >
                Close
              </button>
            }
          >
            {detailQuery.isPending ? (
              <p role="status">Loading event…</p>
            ) : detailQuery.isError ? (
              <p role="alert">
                Could not load event.{' '}
                <button
                  type="button"
                  onClick={() => void detailQuery.refetch()}
                  className="underline"
                >
                  Retry
                </button>
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <p>
                  <strong>UTC time:</strong>{' '}
                  <time dateTime={detailQuery.data.at}>{detailQuery.data.at}</time>
                </p>
                {(['before', 'after', 'metadata'] as const).map((key) => (
                  <div key={key}>
                    <h3 className="font-semibold capitalize">{key}</h3>
                    <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
                      {JSON.stringify(detailQuery.data[key], null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
