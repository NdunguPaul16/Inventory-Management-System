import { CRITICAL_AFTER_MS, WARNING_AFTER_MS } from './reconciliation-runner.js';
import type { ReconciliationOutcome } from './reconciliation-alert.js';

export interface WatchedRun {
  scheduledAtMs: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  outcome?: 'clean' | 'discrepancy' | 'failure';
  lastAlert?: 'warning' | 'failure' | 'recovery';
}

/** Decision logic for a future independent monitor with durable run and alert state. */
export function watchdogOutcome(nowMs: number, run: WatchedRun): ReconciliationOutcome | undefined {
  if (run.finishedAtMs !== undefined) {
    return run.outcome === 'clean' && (run.lastAlert === 'warning' || run.lastAlert === 'failure')
      ? 'recovery'
      : undefined;
  }
  const elapsed = nowMs - run.scheduledAtMs;
  if (elapsed >= CRITICAL_AFTER_MS && run.lastAlert !== 'failure') return 'failure';
  if (elapsed >= WARNING_AFTER_MS && !run.lastAlert) return 'warning';
  return undefined;
}
