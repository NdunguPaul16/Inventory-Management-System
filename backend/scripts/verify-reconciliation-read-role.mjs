import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { reconcileBalances } from '../dist/modules/inventory/engine/service.js';

/** Verify the existing job's snapshot reads using a disposable MongoDB read role. */
async function main() {
  let replicaSet;
  let rootConnection;
  let stage = 'startup';
  try {
    if (!process.env.MONGOMS_SYSTEM_BINARY || !existsSync(process.env.MONGOMS_SYSTEM_BINARY)) {
      throw new Error('A preinstalled local MongoDB binary is required');
    }
    const rootPassword = randomBytes(24).toString('base64url');
    const readerPassword = randomBytes(24).toString('base64url');
    replicaSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
        auth: { enable: true, customRootName: 'local-root', customRootPwd: rootPassword },
      },
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    stage = 'root connection';
    const uri = replicaSet.getUri();
    rootConnection = await mongoose
      .createConnection(uri, {
        dbName: 'ims_staging',
        user: 'local-root',
        pass: rootPassword,
        authSource: 'admin',
        autoIndex: false,
      })
      .asPromise();
    const db = rootConnection.db;
    if (!db || db.databaseName !== 'ims_staging') throw new Error('Unexpected local database');

    const itemId = new Types.ObjectId();
    const locationId = new Types.ObjectId();
    const layerId = new Types.ObjectId();
    const one = Types.Decimal128.fromString('1');
    const zero = Types.Decimal128.fromString('0');
    const at = new Date('2026-01-01T00:00:00.000Z');
    stage = 'fixture insertion';
    await db.collection('stock_balances').insertOne({
      itemId,
      locationId,
      onHand: one,
      reserved: zero,
      value: 100,
      version: 1,
    });
    await db.collection('cost_layers').insertOne({
      _id: layerId,
      itemId,
      locationId,
      receivedAt: at,
      originalQty: one,
      remainingQty: one,
      originalValue: 100,
      remainingValue: 100,
      unitCost: 100,
      sourceDoc: { type: 'LOCAL_TEST', id: '1', number: '1' },
      costHistory: [],
    });
    await db.collection('stock_movements').insertOne({
      movementNo: 'LOCAL-1',
      itemId,
      locationId,
      direction: 'IN',
      quantity: one,
      movementType: 'OPENING',
      unitCost: 100,
      totalCost: 100,
      layerCreated: layerId,
      sourceDoc: { type: 'LOCAL_TEST', id: '1', number: '1' },
      serialNumbers: [],
      idempotencyKey: 'LOCAL-1',
      postedAt: at,
      postedBy: new Types.ObjectId(),
    });
    stage = 'reader creation';
    await db.command({
      createUser: 'local-reader',
      pwd: readerPassword,
      roles: [{ role: 'read', db: 'ims_staging' }],
    });
    await rootConnection.close();
    rootConnection = undefined;

    stage = 'reader connection';
    await mongoose.connect(uri, {
      dbName: 'ims_staging',
      user: 'local-reader',
      pass: readerPassword,
      authSource: 'ims_staging',
      autoIndex: false,
    });
    stage = 'read-only reconciliation';
    const result = await reconcileBalances();
    if (result.checked !== 1 || result.differences.length !== 0) {
      throw new Error('Read-only snapshot reconciliation returned unexpected results');
    }

    stage = 'compiled job';
    const jobUri = new URL(uri);
    jobUri.username = 'local-reader';
    jobUri.password = readerPassword;
    jobUri.searchParams.set('authSource', 'ims_staging');
    const jobPath = fileURLToPath(new URL('../dist/jobs/reconcile-stock.js', import.meta.url));
    const job = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [jobPath], {
        shell: false,
        env: {
          NODE_ENV: 'production',
          MONGODB_URI: jobUri.toString(),
          MONGODB_DB_NAME: 'ims_staging',
          AUTH_RATE_LIMIT_REDIS_URL: 'redis://127.0.0.1:6379',
          AUTH_ACCESS_TOKEN_SECRET: randomBytes(32).toString('base64url'),
          AUTH_REFRESH_TOKEN_SECRET: randomBytes(32).toString('base64url'),
        },
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill(), 30_000);
      child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    if (job.code !== 0 || !/checked=1, differences=0/.test(job.stdout) || job.stderr !== '') {
      throw new Error('Compiled job did not complete with the local read role');
    }

    stage = 'write rejection';
    let writeDenied = false;
    try {
      await mongoose.connection.db?.collection('stock_balances').insertOne({
        itemId: new Types.ObjectId(),
        locationId,
        onHand: one,
        value: 100,
      });
    } catch (error) {
      writeDenied = error?.code === 13 || error?.codeName === 'Unauthorized';
    }
    if (!writeDenied) throw new Error('The local reader unexpectedly wrote stock data');
    process.stdout.write(
      'Local MongoDB read role completed the compiled reconciliation job and rejected a write.\n',
    );
  } catch (error) {
    const kind = error instanceof Error ? error.name : 'Error';
    const code = typeof error?.code === 'number' ? error.code : 'none';
    process.stderr.write(
      `Local reconciliation read-role verification failed at ${stage} (${kind}, code ${code}).\n`,
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    if (rootConnection) await rootConnection.close();
    if (replicaSet) await replicaSet.stop();
  }
}

await main();
