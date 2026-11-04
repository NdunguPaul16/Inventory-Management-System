import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-green-100 text-green-800 ring-green-600/20',
  warning: 'bg-orange-100 text-orange-800 ring-orange-600/20',
  danger: 'bg-red-100 text-red-800 ring-red-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

const DOTS: Record<BadgeTone, string> = {
  success: 'bg-green-500',
  warning: 'bg-orange-500',
  danger: 'bg-red-500',
  neutral: 'bg-slate-400',
};

/** Green / orange / red status badge (UI convention in CLAUDE.md). */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}
