import { Card, PageHeader } from './Card';

export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-sm text-slate-600">
          This page arrives in <strong className="text-slate-900">Phase {phase}</strong>. See{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            docs/02-development-phases.md
          </code>
          .
        </p>
      </Card>
    </>
  );
}
