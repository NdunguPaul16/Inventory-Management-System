import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReconciliationEmailNotifier,
  reconciliationEmailSettings,
} from '../src/jobs/reconciliation-alert.js';
import {
  CRITICAL_AFTER_MS,
  runStockReconciliation,
  WARNING_AFTER_MS,
} from '../src/jobs/reconciliation-runner.js';
import { watchdogOutcome } from '../src/jobs/reconciliation-watchdog.js';
import { assertStagingMongoIsolation } from '../src/jobs/staging-mongo-isolation.js';

const staging = {
  NODE_ENV: 'production',
  MONGODB_DB_NAME: 'ims_staging',
  MONGODB_URI: 'mongodb+srv://synthetic:synthetic@staging.mongodb.net/ims_staging',
  STAGING_ATLAS_HOST: 'staging.mongodb.net',
  PRODUCTION_ATLAS_HOST: 'production.mongodb.net',
};

afterEach(() => vi.useRealTimers());

describe('Mongo-only staging preflight', () => {
  it('accepts the pinned staging Atlas database without web authentication or Key Value settings', () => {
    expect(assertStagingMongoIsolation(staging)).toEqual({
      uri: staging.MONGODB_URI,
      dbName: 'ims_staging',
    });
    expect(
      assertStagingMongoIsolation({
        ...staging,
        MONGODB_URI: 'mongodb+srv://synthetic:synthetic@staging.mongodb.net',
      }).dbName,
    ).toBe('ims_staging');
  });

  it.each([
    [{ MONGODB_DB_NAME: 'ims' }, 'database name'],
    [
      { MONGODB_URI: 'mongodb+srv://synthetic:synthetic@production.mongodb.net/ims_staging' },
      'Atlas target',
    ],
    [{ MONGODB_URI: 'mongodb+srv://synthetic:synthetic@staging.mongodb.net/ims' }, 'Atlas target'],
    [{ STAGING_ATLAS_HOST: 'production.mongodb.net' }, 'host pins'],
    [{ NODE_ENV: 'test' }, 'runtime mode'],
  ])('rejects an unsafe target before connecting', (override, message) => {
    expect(() => assertStagingMongoIsolation({ ...staging, ...override })).toThrow(message);
  });
});

describe('staging reconciliation notifications', () => {
  const connect = vi.fn(async () => undefined as never);
  const disconnect = vi.fn(async () => undefined);
  const send = vi.fn(async () => undefined);

  it('reports clean and discrepancies without writing stock', async () => {
    connect.mockClear();
    disconnect.mockClear();
    send.mockClear();
    const clean = await runStockReconciliation(staging, true, {
      connect,
      disconnect,
      reconcile: async () => ({ checked: 5, differences: [] }),
      notifier: { send },
    });
    expect(clean.exitCode).toBe(0);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'clean', checked: 5 }));
    const drift = await runStockReconciliation(staging, true, {
      connect,
      disconnect,
      reconcile: async () => ({ checked: 5, differences: [{} as never] }),
      notifier: { send },
    });
    expect(drift.exitCode).toBe(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'discrepancy', differences: 1 }),
    );
    expect(connect).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('returns one for job, close, or required email failure', async () => {
    for (const dependencies of [
      { reconcile: async () => Promise.reject(new Error('synthetic failure')) },
      {
        reconcile: async () => ({ checked: 0, differences: [] }),
        disconnect: async () => Promise.reject(new Error('synthetic close failure')),
      },
      {
        reconcile: async () => ({ checked: 0, differences: [] }),
        notifier: { send: async () => Promise.reject(new Error('synthetic email failure')) },
      },
    ]) {
      const result = await runStockReconciliation(staging, true, {
        connect,
        disconnect,
        notifier: { send },
        ...dependencies,
      });
      expect(result.exitCode).toBe(1);
    }
  });

  it('fails before any connection when the target or required email settings are invalid', async () => {
    connect.mockClear();
    send.mockClear();
    const badTarget = await runStockReconciliation({ ...staging, MONGODB_DB_NAME: 'ims' }, true, {
      connect,
      notifier: { send },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    const noEmail = await runStockReconciliation(staging, true, { connect });
    expect([badTarget.exitCode, noEmail.exitCode]).toEqual([1, 1]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('sends a warning at 15 minutes and a critical failure at 30 minutes', async () => {
    vi.useFakeTimers();
    const sendAlert = vi.fn(async () => undefined);
    let finish: ((value: { checked: number; differences: [] }) => void) | undefined;
    const reconcile = () =>
      new Promise<{ checked: number; differences: [] }>((resolve) => {
        finish = resolve;
      });
    const run = runStockReconciliation(staging, true, {
      connect,
      disconnect,
      reconcile,
      notifier: { send: sendAlert },
    });
    await vi.advanceTimersByTimeAsync(WARNING_AFTER_MS);
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'warning' }));
    await vi.advanceTimersByTimeAsync(CRITICAL_AFTER_MS - WARNING_AFTER_MS);
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    finish?.({ checked: 5, differences: [] });
    expect((await run).exitCode).toBe(1);
  });
});

describe('email adapter and independent watchdog decisions', () => {
  const emailSource = {
    RECONCILE_EMAIL_API_KEY: 'synthetic-key',
    RECONCILE_EMAIL_FROM: 'alerts@example.test',
    RECONCILE_EMAIL_TO: 'admin1@example.test,admin2@example.test',
  };

  it('uses only the approved email API and never includes provider errors in thrown messages', async () => {
    const settings = reconciliationEmailSettings(emailSource);
    const transport = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    const notifier = createReconciliationEmailNotifier(settings, transport);
    await notifier.send({ outcome: 'recovery', at: '2026-11-21T00:00:00.000Z' });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });
    transport.mockResolvedValueOnce({ ok: false } as Response);
    await expect(
      notifier.send({ outcome: 'failure', at: '2026-11-21T00:00:00.000Z' }),
    ).rejects.toThrow('Reconciliation notification failed');
    expect(() => reconciliationEmailSettings({ ...emailSource, RECONCILE_EMAIL_TO: '' })).toThrow(
      'configuration is incomplete',
    );
  });

  it('detects missing, stalled, and recovered runs without depending on the running job', () => {
    const scheduledAtMs = 0;
    expect(watchdogOutcome(WARNING_AFTER_MS - 1, { scheduledAtMs })).toBeUndefined();
    expect(watchdogOutcome(WARNING_AFTER_MS, { scheduledAtMs })).toBe('warning');
    expect(
      watchdogOutcome(CRITICAL_AFTER_MS, { scheduledAtMs, startedAtMs: 1, lastAlert: 'warning' }),
    ).toBe('failure');
    expect(
      watchdogOutcome(CRITICAL_AFTER_MS + 1, { scheduledAtMs, lastAlert: 'failure' }),
    ).toBeUndefined();
    expect(
      watchdogOutcome(CRITICAL_AFTER_MS + 1, {
        scheduledAtMs,
        finishedAtMs: 2,
        outcome: 'clean',
        lastAlert: 'failure',
      }),
    ).toBe('recovery');
    expect(
      watchdogOutcome(CRITICAL_AFTER_MS + 1, {
        scheduledAtMs,
        finishedAtMs: 2,
        outcome: 'clean',
        lastAlert: 'recovery',
      }),
    ).toBeUndefined();
  });
});
