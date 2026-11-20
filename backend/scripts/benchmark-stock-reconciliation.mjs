import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CostLayer, StockBalance, StockMovement } from '../dist/modules/inventory/engine/models.js';
import { reconcileBalances } from '../dist/modules/inventory/engine/service.js';

// This is a local algorithm benchmark, not a staging acceptance run. The URI is
// created here and cannot be supplied by an environment variable or argument.
const SKU_COUNT = 1_000;
const LOCATION_COUNT = 5;
const LAYERS_PER_PAIR = 4;
const MOVEMENTS_PER_PAIR = 20;
const BATCH_SIZE = 1_000;
const quantityOne = Types.Decimal128.fromString('1');
const quantityFour = Types.Decimal128.fromString('4');
const quantityFive = Types.Decimal128.fromString('5');
const zero = Types.Decimal128.fromString('0');

function queryStats(explain) {
  const stats = explain.executionStats;
  return {
    returned: stats.nReturned,
    keysExamined: stats.totalKeysExamined,
    docsExamined: stats.totalDocsExamined,
    executionMs: stats.executionTimeMillis,
  };
}

async function flush(collection, batch) {
  if (batch.length === 0) return;
  await collection.insertMany(batch, { ordered: true });
  batch.length = 0;
}

async function main() {
  let replicaSet;
  try {
    if (!process.env.MONGOMS_SYSTEM_BINARY || !existsSync(process.env.MONGOMS_SYSTEM_BINARY)) {
      throw new Error('A preinstalled local MongoDB binary is required');
    }
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    await mongoose.connect(replicaSet.getUri(), {
      dbName: `local_stock_benchmark_${randomUUID().slice(0, 8)}`,
      autoIndex: false,
    });
    const db = mongoose.connection.db;
    if (!db) throw new Error('Local database unavailable');

    await Promise.all([
      StockBalance.createIndexes(),
      CostLayer.createIndexes(),
      StockMovement.createIndexes(),
    ]);
    const itemIds = Array.from({ length: SKU_COUNT }, () => new Types.ObjectId());
    const locationIds = Array.from({ length: LOCATION_COUNT }, () => new Types.ObjectId());
    await db.collection('items').insertMany(
      itemIds.map((_id, index) => ({
        _id,
        sku: `LOCAL-VOLUME-${String(index).padStart(4, '0')}`,
        name: `Local volume item ${index}`,
        type: 'TRADING_GOOD',
        baseUnit: 'PCS',
        isActive: true,
      })),
    );
    await db.collection('locations').insertMany(
      locationIds.map((_id, index) => ({
        _id,
        code: `LOCAL-VOLUME-${index}`,
        name: `Local volume location ${index}`,
        type: 'WAREHOUSE',
        isActive: true,
      })),
    );

    const balances = [];
    const layers = [];
    const movements = [];
    const postedBy = new Types.ObjectId();
    const at = new Date('2026-01-01T00:00:00.000Z');
    let movementNumber = 0;
    for (const itemId of itemIds) {
      for (const locationId of locationIds) {
        balances.push({
          itemId,
          locationId,
          onHand: quantityFour,
          reserved: zero,
          value: 400,
          version: 20,
          lastMovementAt: at,
        });
        for (let layerIndex = 0; layerIndex < LAYERS_PER_PAIR; layerIndex += 1) {
          const layerId = new Types.ObjectId();
          const sourceId = `LOCAL-${itemId}-${locationId}-${layerIndex}`;
          layers.push({
            _id: layerId,
            itemId,
            locationId,
            sourceDoc: { type: 'LOCAL_BENCHMARK', id: sourceId, number: sourceId },
            receivedAt: at,
            originalQty: quantityFive,
            remainingQty: quantityOne,
            originalValue: 500,
            remainingValue: 100,
            unitCost: 100,
            costHistory: [],
          });
          movementNumber += 1;
          movements.push({
            movementNo: `LOCAL-${movementNumber}`,
            itemId,
            locationId,
            direction: 'IN',
            quantity: quantityFive,
            movementType: 'OPENING',
            unitCost: 100,
            totalCost: 500,
            layerCreated: layerId,
            sourceDoc: { type: 'LOCAL_BENCHMARK', id: sourceId, number: sourceId },
            serialNumbers: [],
            idempotencyKey: `LOCAL-${movementNumber}`,
            postedAt: at,
            postedBy,
          });
          for (let issue = 0; issue < 4; issue += 1) {
            movementNumber += 1;
            movements.push({
              movementNo: `LOCAL-${movementNumber}`,
              itemId,
              locationId,
              direction: 'OUT',
              quantity: quantityOne,
              movementType: 'ADJUSTMENT_OUT',
              unitCost: 100,
              totalCost: 100,
              layersConsumed: [{ layerId, quantity: quantityOne, unitCost: 100, totalCost: 100 }],
              sourceDoc: {
                type: 'LOCAL_BENCHMARK',
                id: `LOCAL-${movementNumber}`,
                number: `LOCAL-${movementNumber}`,
              },
              serialNumbers: [],
              idempotencyKey: `LOCAL-${movementNumber}`,
              postedAt: at,
              postedBy,
            });
          }
        }
        if (balances.length >= BATCH_SIZE) await flush(db.collection('stock_balances'), balances);
        if (layers.length >= BATCH_SIZE) await flush(db.collection('cost_layers'), layers);
        if (movements.length >= BATCH_SIZE) {
          await flush(db.collection('stock_movements'), movements);
        }
      }
    }
    await flush(db.collection('stock_balances'), balances);
    await flush(db.collection('cost_layers'), layers);
    await flush(db.collection('stock_movements'), movements);

    const counts = {
      skus: await db.collection('items').countDocuments(),
      locations: await db.collection('locations').countDocuments(),
      balances: await db.collection('stock_balances').countDocuments(),
      layers: await db.collection('cost_layers').countDocuments(),
      movements: await db.collection('stock_movements').countDocuments(),
    };
    if (
      counts.skus !== SKU_COUNT ||
      counts.locations !== LOCATION_COUNT ||
      counts.balances !== SKU_COUNT * LOCATION_COUNT ||
      counts.layers !== SKU_COUNT * LOCATION_COUNT * LAYERS_PER_PAIR ||
      counts.movements !== SKU_COUNT * LOCATION_COUNT * MOVEMENTS_PER_PAIR
    ) {
      throw new Error('Local benchmark fixture has an unexpected record count');
    }

    let peakRss = process.memoryUsage().rss;
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);
    let result;
    const started = performance.now();
    try {
      result = await reconcileBalances();
    } finally {
      clearInterval(sampler);
    }
    const elapsedMs = Math.round(performance.now() - started);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (result.checked !== counts.balances || result.differences.length !== 0) {
      throw new Error('Local benchmark ledger did not reconcile');
    }

    const itemId = itemIds[0];
    const locationId = locationIds[0];
    const queryPlans = {
      balancePage: queryStats(
        await db
          .collection('stock_balances')
          .find({})
          .sort({ _id: -1 })
          .limit(50)
          .explain('executionStats'),
      ),
      fifoLayerPage: queryStats(
        await db
          .collection('cost_layers')
          .find({ itemId, locationId })
          .sort({ receivedAt: 1, _id: 1 })
          .limit(50)
          .explain('executionStats'),
      ),
      movementPage: queryStats(
        await db
          .collection('stock_movements')
          .find({ itemId })
          .sort({ _id: -1 })
          .limit(50)
          .explain('executionStats'),
      ),
    };
    process.stdout.write(
      `${JSON.stringify({
        environment: 'local in-memory replica set',
        fixture: 'synthetic direct inserts; posting throughput not measured',
        counts,
        reconciliation: {
          checked: result.checked,
          differences: result.differences.length,
          elapsedMs,
          peakProcessRssMiB: Math.round(peakRss / 1024 / 1024),
        },
        queryPlans,
      })}\n`,
    );
  } catch {
    process.stderr.write(
      'Local reconciliation benchmark failed. No deployed database was contacted.\n',
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    if (replicaSet) await replicaSet.stop();
  }
}

await main();
