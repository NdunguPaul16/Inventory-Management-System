import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose, { Types } from 'mongoose';
import { beforeAll, describe, expect, it, inject } from 'vitest';
import { AuditLog } from '../src/modules/audit/model.js';
import { CostLayer, StockBalance, StockMovement } from '../src/modules/inventory/engine/models.js';
import { postIn } from '../src/modules/inventory/engine/service.js';
import { Item } from '../src/modules/inventory/items/model.js';
import { Location } from '../src/modules/inventory/locations/model.js';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const tscPath = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));

function childResult(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: backendRoot, shell: false, env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const childEnv = {
  NODE_ENV: 'test',
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}),
  ...(process.env.TMP ? { TMP: process.env.TMP } : {}),
};

function runReconciliationJob(databaseName: string) {
  return childResult(process.execPath, ['dist/jobs/reconcile-stock.js'], {
    ...childEnv,
    MONGODB_URI: inject('mongoUri'),
    MONGODB_DB_NAME: databaseName,
  });
}

describe('read-only stock reconciliation job', () => {
  beforeAll(async () => {
    const build = await childResult(
      process.execPath,
      [tscPath, '-p', 'tsconfig.build.json'],
      childEnv,
    );
    expect(build.code).toBe(0);
  }, 60_000);

  it('fails closed with a generic error when database configuration is missing', async () => {
    const result = await childResult(process.execPath, ['dist/jobs/reconcile-stock.js'], childEnv);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Stock reconciliation failed; no stock records were changed.\n');
  });

  it('exits zero for consistent stock and two for drift without changing records', async () => {
    const databaseName = mongoose.connection.db?.databaseName;
    if (!databaseName) throw new Error('In-memory test database is unavailable');
    const item = await Item.create({
      sku: `RECON-${randomUUID().slice(0, 8)}`,
      name: 'Reconciliation test item',
      type: 'TRADING_GOOD',
      baseUnit: 'PCS',
    });
    const location = await Location.create({
      code: `RECON-${randomUUID().slice(0, 8)}`,
      name: 'Reconciliation test location',
      type: 'WAREHOUSE',
    });
    await postIn({
      itemId: item._id,
      locationId: location._id,
      quantity: '2',
      unitCost: 123,
      movementType: 'OPENING',
      sourceDoc: { type: 'TEST', id: randomUUID(), number: 'RECON-1' },
      postedBy: new Types.ObjectId(),
      idempotencyKey: randomUUID(),
    });
    const stockCounts = async () => ({
      balances: await StockBalance.countDocuments(),
      layers: await CostLayer.countDocuments(),
      movements: await StockMovement.countDocuments(),
      audits: await AuditLog.countDocuments(),
    });
    const before = await stockCounts();

    const clean = await runReconciliationJob(databaseName);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toMatch(/checked=1, differences=0/);
    expect(clean.stderr).toBe('');
    expect(await stockCounts()).toEqual(before);

    await StockBalance.updateOne(
      { itemId: item._id, locationId: location._id },
      { $set: { value: 247 } },
    );
    const drift = await runReconciliationJob(databaseName);
    expect(drift.code).toBe(2);
    expect(drift.stdout).toMatch(/checked=1, differences=1/);
    expect(drift.stderr).toBe('');
    expect(await stockCounts()).toEqual(before);
    expect(
      (await StockBalance.findOne({ itemId: item._id, locationId: location._id }))?.value,
    ).toBe(247);
  });
});
