import type { ReactNode } from 'react';
import { Card, PageHeader } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime, formatDuration } from '../../lib/format';
import { useHealth } from './useHealth';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function SystemStatusPage() {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useHealth();

  return (
    <>
      <PageHeader
        title="System status"
        description="Live health of the API and the MongoDB connection."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-slate-500">
            Last checked {formatDateTime(new Date(dataUpdatedAt))}
          </span>
        )}
      </div>

      {isPending && <p className="text-sm text-slate-600">Checking the API…</p>}

      {error && !data && (
        <Card title="API">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="danger">Unreachable</StatusBadge>
            <p className="text-sm text-slate-600">{error.message}</p>
          </div>
        </Card>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="API"
            actions={
              data.status === 'ok' ? (
                <StatusBadge tone="success">Operational</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Degraded</StatusBadge>
              )
            }
          >
            <dl className="divide-y divide-slate-100">
              <Row label="Service">{data.app.name}</Row>
              <Row label="Version">{data.app.version}</Row>
              <Row label="Environment">{data.app.environment}</Row>
              <Row label="Uptime">{formatDuration(data.app.uptimeSeconds)}</Row>
              <Row label="Server time">{formatDateTime(data.time)}</Row>
            </dl>
          </Card>

          <Card
            title="Database (MongoDB)"
            actions={
              data.db.status === 'up' ? (
                <StatusBadge tone="success">Up</StatusBadge>
              ) : (
                <StatusBadge tone="danger">Down</StatusBadge>
              )
            }
          >
            <dl className="divide-y divide-slate-100">
              <Row label="Connection">{data.db.state}</Row>
              <Row label="Ping">{data.db.latencyMs === null ? '—' : `${data.db.latencyMs} ms`}</Row>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
