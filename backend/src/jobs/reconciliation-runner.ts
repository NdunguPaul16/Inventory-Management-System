import { connectDb, disconnectDb } from '../config/db.js';
import { parseEnv } from '../config/env.js';
import { reconcileBalances } from '../modules/inventory/engine/service.js';
import {
  createReconciliationEmailNotifier,
  reconciliationEmailSettings,
  type ReconciliationNotifier,
  type ReconciliationOutcome,
} from './reconciliation-alert.js';
import { assertStagingMongoIsolation } from './staging-mongo-isolation.js';

export const WARNING_AFTER_MS = 15 * 60_000;
export const CRITICAL_AFTER_MS = 30 * 60_000;

type Result = Awaited<ReturnType<typeof reconcileBalances>>;

export interface ReconciliationDependencies {
  connect?: typeof connectDb;
  disconnect?: typeof disconnectDb;
  reconcile?: () => Promise<Result>;
  notifier?: ReconciliationNotifier;
  now?: () => number;
}

export interface ReconciliationRun {
  exitCode: 0 | 1 | 2;
  checked?: number;
  differences?: number;
  elapsedMs?: number;
}

/** Runs one read-only snapshot comparison and makes notification failures visible to the scheduler. */
export async function runStockReconciliation(
  source: NodeJS.ProcessEnv,
  stagingOnly: boolean,
  dependencies: ReconciliationDependencies = {},
): Promise<ReconciliationRun> {
  let uri: string;
  let dbName: string;
  let notifier: ReconciliationNotifier | undefined;
  try {
    if (stagingOnly) {
      notifier =
        dependencies.notifier ??
        createReconciliationEmailNotifier(reconciliationEmailSettings(source));
      ({ uri, dbName } = assertStagingMongoIsolation(source));
    } else {
      const env = parseEnv(source);
      if (!env.MONGODB_URI || !source.MONGODB_DB_NAME)
        throw new Error('Database configuration is incomplete');
      uri = env.MONGODB_URI;
      dbName = env.MONGODB_DB_NAME;
      notifier = dependencies.notifier;
    }
  } catch {
    if (stagingOnly && notifier) {
      try {
        await notifier.send({ outcome: 'failure', at: new Date().toISOString() });
      } catch {
        // The safe failure exit remains 1 even if the alert provider is unavailable.
      }
    }
    return { exitCode: 1 };
  }

  const now = dependencies.now ?? Date.now;
  const started = now();
  const pending: Promise<void>[] = [];
  let notificationFailed = false;
  let critical = false;
  let connected = false;
  let failed = false;
  let result: Result | undefined;

  function notify(outcome: ReconciliationOutcome): void {
    if (!notifier) return;
    pending.push(
      notifier
        .send({
          outcome,
          at: new Date().toISOString(),
          checked: result?.checked,
          differences: result?.differences.length,
          elapsedMs: now() - started,
        })
        .catch(() => {
          notificationFailed = true;
        }),
    );
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  if (stagingOnly) {
    timers.push(setTimeout(() => notify('warning'), WARNING_AFTER_MS));
    timers.push(
      setTimeout(() => {
        critical = true;
        notify('failure');
      }, CRITICAL_AFTER_MS),
    );
  }
  try {
    await (dependencies.connect ?? connectDb)(uri, { dbName, autoIndex: false });
    connected = true;
    result = await (dependencies.reconcile ?? reconcileBalances)();
  } catch {
    failed = true;
  } finally {
    for (const timer of timers) clearTimeout(timer);
    if (connected) {
      try {
        await (dependencies.disconnect ?? disconnectDb)();
      } catch {
        failed = true;
      }
    }
  }

  if (failed && !critical) notify('failure');
  if (!failed && !critical) notify(result?.differences.length ? 'discrepancy' : 'clean');
  await Promise.all(pending);
  const elapsedMs = now() - started;
  if (failed || critical || notificationFailed || !result) {
    return {
      exitCode: 1,
      checked: result?.checked,
      differences: result?.differences.length,
      elapsedMs,
    };
  }
  return {
    exitCode: result.differences.length ? 2 : 0,
    checked: result.checked,
    differences: result.differences.length,
    elapsedMs,
  };
}
