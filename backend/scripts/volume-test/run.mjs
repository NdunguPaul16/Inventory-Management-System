import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { reconcileBalances } from '../../dist-staging/modules/inventory/engine/service.js';
import { connectVolume, disconnectVolume, reportFailure } from './db.mjs';
import { assertVolumeTarget, parseScale } from './guard.mjs';

function errorCategory(error) {
  if (error?.code === 50 || error?.codeName === 'MaxTimeMSExpired') return 'transaction_timeout';
  if (error?.code === 13 || error?.codeName === 'Unauthorized') return 'authorization';
  if (error?.name === 'MongoServerSelectionError') return 'database_unavailable';
  return 'execution';
}

export async function measureReconciliation(reconcile = reconcileBalances, measurement = {}) {
  const clock = measurement.clock ?? performance.now.bind(performance);
  const rss = measurement.rss ?? (() => process.memoryUsage().rss);
  let peakRssBytes = rss();
  let scanned;
  const sample = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, rss());
  }, 100);
  const started = clock();
  try {
    const result = await reconcile((counts) => (scanned = counts), { singleAttempt: true });
    const elapsedMs = Math.round(clock() - started);
    peakRssBytes = Math.max(peakRssBytes, rss());
    if (!scanned) throw new Error('Stream counts were not reported');
    return {
      exitCode: result.differences.length ? 2 : 0,
      elapsedMs,
      peakRssBytes,
      scanned,
      checked: result.checked,
      discrepancies: result.differences.length,
      warningExceeded: elapsedMs > 15 * 60_000,
      criticalExceeded: elapsedMs > 30 * 60_000,
    };
  } catch (error) {
    return {
      exitCode: 1,
      elapsedMs: Math.round(clock() - started),
      peakRssBytes: Math.max(peakRssBytes, rss()),
      errorCategory: errorCategory(error),
    };
  } finally {
    clearInterval(sample);
  }
}

export function enforceExpectedVolume(result, expected) {
  if (result.exitCode !== 0) return result;
  if (
    result.checked !== expected.balances ||
    result.scanned.balances !== expected.balances ||
    result.scanned.layers !== expected.layers ||
    result.scanned.movements !== expected.movements
  ) {
    return { ...result, exitCode: 1, errorCategory: 'unexpected_volume' };
  }
  return result;
}

async function main() {
  let connected = false;
  try {
    const scale = parseScale(process.argv.slice(2));
    const target = assertVolumeTarget(process.env, scale);
    await connectVolume(target, 'read');
    connected = true;
    const result = enforceExpectedVolume(await measureReconciliation(), target.expected);
    process.stdout.write(`${JSON.stringify({ scale, database: target.dbName, ...result })}\n`);
    process.exitCode = result.exitCode;
  } catch {
    reportFailure('reconciliation');
  } finally {
    if (connected) await disconnectVolume().catch(() => reportFailure('disconnect', 'execution'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
