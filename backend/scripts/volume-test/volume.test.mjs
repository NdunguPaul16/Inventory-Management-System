import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Item } from '../../dist-staging/modules/inventory/items/model.js';
import { Location } from '../../dist-staging/modules/inventory/locations/model.js';
import {
  CostLayer,
  StockBalance,
  StockMovement,
} from '../../dist-staging/modules/inventory/engine/models.js';
import { seedFixture } from './seed.mjs';
import { assertDatabaseRole } from './db.mjs';
import { verifyFixture } from './verify.mjs';
import { enforceExpectedVolume, measureReconciliation } from './run.mjs';
import { assertVolumeTarget, expectedVolume, parseScale } from './guard.mjs';
import { fixtureBatches } from './fixture.mjs';

const approvedHost = 'disposable.example.mongodb.net';
const baseEnv = {
  NODE_ENV: 'production',
  STAGING_ATLAS_HOST: 'operational.example.mongodb.net',
  PRODUCTION_ATLAS_HOST: 'production.example.mongodb.net',
  MONGODB_DB_NAME: 'ims_volume_trial',
  MONGODB_URI: 'mongodb+srv://fixture:secret@disposable.example.mongodb.net/ims_volume_trial',
};

test('guard accepts only a separately pinned disposable target and matching effective database', () => {
  assert.equal(assertVolumeTarget(baseEnv, 10, approvedHost).dbName, 'ims_volume_trial');
  assert.equal(
    assertVolumeTarget(
      {
        ...baseEnv,
        MONGODB_DB_NAME: 'ims_volume_full',
        MONGODB_URI: baseEnv.MONGODB_URI.replaceAll('trial', 'full'),
      },
      100,
      approvedHost,
    ).dbName,
    'ims_volume_full',
  );
  assert.throws(() => assertVolumeTarget(baseEnv, 10), /Approved|Disposable/);
  for (const changed of [
    { MONGODB_DB_NAME: 'ims_staging' },
    { MONGODB_DB_NAME: 'ims' },
    { MONGODB_URI: baseEnv.MONGODB_URI.replace('disposable', 'operational') },
    { MONGODB_URI: baseEnv.MONGODB_URI.replace('mongodb+srv', 'mongodb') },
    { MONGODB_URI: `${baseEnv.MONGODB_URI}?dbName=ims_staging` },
    { MONGODB_URI: baseEnv.MONGODB_URI.replace('disposable.example', 'disposable..example') },
    { STAGING_ATLAS_HOST: approvedHost },
    { PRODUCTION_ATLAS_HOST: approvedHost },
    { NODE_ENV: 'test' },
  ]) {
    assert.throws(() => assertVolumeTarget({ ...baseEnv, ...changed }, 10, approvedHost));
  }
  assert.throws(() => assertVolumeTarget(baseEnv, 10, approvedHost, { dbName: 'ims_staging' }));
  assert.throws(() => assertVolumeTarget(baseEnv, 10, approvedHost, { dbName: '' }));
  assert.throws(() => parseScale(['--scale=25']));
  assert.throws(() => parseScale(['--scale=10', '--scale=100']));
});

test('every CLI fails before attempting a connection while the host allowlist is empty', () => {
  for (const script of ['seed.mjs', 'verify.mjs', 'run.mjs']) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(script, import.meta.url)), '--scale=10'],
      {
        env: {
          ...baseEnv,
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        },
        encoding: 'utf8',
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 1);
    assert.ok(!result.error);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('fixture:secret'));
  }
});

test('reader and writer identities cannot carry broader or cross-database roles', () => {
  assert.doesNotThrow(() =>
    assertDatabaseRole(
      { authInfo: { authenticatedUserRoles: [{ role: 'read', db: 'ims_volume_trial' }] } },
      'read',
      'ims_volume_trial',
    ),
  );
  for (const roles of [
    [{ role: 'readWrite', db: 'ims_volume_trial' }],
    [{ role: 'read', db: 'ims_staging' }],
    [
      { role: 'read', db: 'ims_volume_trial' },
      { role: 'read', db: 'ims' },
    ],
    [{ role: 'readAnyDatabase', db: 'admin' }],
  ]) {
    assert.throws(() =>
      assertDatabaseRole(
        { authInfo: { authenticatedUserRoles: roles } },
        'read',
        'ims_volume_trial',
      ),
    );
  }
  assert.doesNotThrow(() =>
    assertDatabaseRole(
      { authInfo: { authenticatedUserRoles: [{ role: 'readWrite', db: 'ims_volume_full' }] } },
      'readWrite',
      'ims_volume_full',
    ),
  );
});

test('fixture generator has bounded deterministic batches and both exact scales', () => {
  for (const scale of [10, 100]) {
    const expected = expectedVolume(scale);
    const counts = {
      items: 0,
      locations: 0,
      stock_balances: 0,
      cost_layers: 0,
      stock_movements: 0,
    };
    const first = fixtureBatches(scale).next().value;
    assert.equal(first.documents[0].sku, 'VOLUME-0000');
    for (const batch of fixtureBatches(scale)) {
      assert.ok(batch.documents.length > 0 && batch.documents.length <= 1_000);
      counts[batch.collection] += batch.documents.length;
    }
    assert.deepEqual(counts, {
      items: expected.skus,
      locations: expected.locations,
      stock_balances: expected.balances,
      cost_layers: expected.layers,
      stock_movements: expected.movements,
    });
  }
});

test('nonempty databases are rejected before indexes or inserts', async () => {
  let writes = 0;
  const fakeDb = {
    listCollections: () => ({ toArray: async () => [{ name: 'existing' }] }),
    collection: () => ({
      insertMany: async () => {
        writes += 1;
      },
    }),
  };
  await assert.rejects(
    seedFixture(fakeDb, 10, async () => {
      writes += 1;
    }),
    /no collections/,
  );
  assert.equal(writes, 0);
});

test('measurement reports clean, discrepancy, and execution exits without retrying', async () => {
  let attempts = 0;
  const clean = await measureReconciliation(async (onScanned, options) => {
    attempts += 1;
    assert.equal(options.singleAttempt, true);
    onScanned({ balances: 500, layers: 2_000, movements: 10_000 });
    return { checked: 500, differences: [] };
  });
  assert.equal(attempts, 1);
  assert.equal(clean.exitCode, 0);
  assert.equal(enforceExpectedVolume(clean, expectedVolume(10)).exitCode, 0);
  assert.equal(
    enforceExpectedVolume(clean, expectedVolume(100)).errorCategory,
    'unexpected_volume',
  );
  assert.deepEqual(clean.scanned, { balances: 500, layers: 2_000, movements: 10_000 });
  assert.ok(clean.elapsedMs >= 0 && clean.peakRssBytes > 0);
  const drift = await measureReconciliation(async (onScanned) => {
    onScanned({ balances: 1, layers: 1, movements: 5 });
    return { checked: 1, differences: [{}] };
  });
  assert.equal(drift.exitCode, 2);
  const failure = await measureReconciliation(async () => {
    attempts += 1;
    throw new Error('synthetic-credential-must-stay-private');
  });
  assert.equal(attempts, 2);
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.errorCategory, 'execution');
  assert.ok(!JSON.stringify(failure).includes('synthetic-credential'));
});

test('both synthetic volumes reconcile on a disposable local replica set without stock writes', async () => {
  if (!process.env.MONGOMS_SYSTEM_BINARY || !existsSync(process.env.MONGOMS_SYSTEM_BINARY)) {
    throw new Error('A preinstalled local MongoDB binary is required');
  }
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  try {
    for (const scale of [10, 100]) {
      await mongoose.connect(replicaSet.getUri(), {
        dbName: `local_volume_${scale}`,
        autoIndex: false,
        autoCreate: false,
      });
      const db = mongoose.connection.db;
      assert.ok(db);
      const indexes = async () => {
        await Item.createIndexes();
        await Location.createIndexes();
        await StockBalance.createIndexes();
        await CostLayer.createIndexes();
        await StockMovement.createIndexes();
      };
      const inserted = await seedFixture(db, scale, indexes);
      assert.equal(inserted.stock_movements, expectedVolume(scale).movements);
      await assert.rejects(seedFixture(db, scale, indexes), /no collections/);
      const counts = await verifyFixture(db, scale);
      assert.equal(counts.layers, expectedVolume(scale).layers);
      const before = await db.collection('stock_balances').findOne({});
      const result = await measureReconciliation();
      assert.equal(result.exitCode, 0);
      assert.equal(result.checked, expectedVolume(scale).balances);
      assert.deepEqual(result.scanned, {
        balances: expectedVolume(scale).balances,
        layers: expectedVolume(scale).layers,
        movements: expectedVolume(scale).movements,
      });
      assert.deepEqual(await db.collection('stock_balances').findOne({ _id: before._id }), before);
      if (scale === 10) {
        await db
          .collection('stock_balances')
          .updateOne({ _id: before._id }, { $inc: { value: 1 } });
        const discrepancy = await measureReconciliation();
        assert.equal(discrepancy.exitCode, 2);
        assert.equal(discrepancy.discrepancies, 1);
        assert.equal(
          (await db.collection('stock_balances').findOne({ _id: before._id })).value,
          before.value + 1,
        );
      }
      await mongoose.disconnect();
    }
  } finally {
    await mongoose.disconnect();
    await replicaSet.stop();
  }
});
