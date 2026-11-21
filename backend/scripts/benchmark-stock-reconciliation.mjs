import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Item } from '../dist/modules/inventory/items/model.js';
import { Location } from '../dist/modules/inventory/locations/model.js';
import { CostLayer, StockBalance, StockMovement } from '../dist/modules/inventory/engine/models.js';
import {
  getFifoLayers,
  listStockBalances,
  reconcileBalances,
} from '../dist/modules/inventory/engine/service.js';

// This is a local algorithm benchmark, not a staging acceptance run. The URI is
// created here and cannot be supplied by an environment variable or argument.
const SKU_COUNT = 1_000;
const LOCATION_COUNT = 5;
const LAYERS_PER_PAIR = 4;
const MOVEMENTS_PER_PAIR = 20;
const PAGED_PAIR_LAYERS = 75;
const REDUCED_PAIR_COUNT = PAGED_PAIR_LAYERS - LAYERS_PER_PAIR;
const BATCH_SIZE = 1_000;
const quantityOne = Types.Decimal128.fromString('1');
const quantityFive = Types.Decimal128.fromString('5');
const zero = Types.Decimal128.fromString('0');

function queryStats(explain) {
  const stats = explain.executionStats;
  const indexes = new Set();
  function collectIndexes(stage) {
    if (!stage || typeof stage !== 'object') return;
    if (typeof stage.indexName === 'string') indexes.add(stage.indexName);
    for (const value of Object.values(stage)) {
      if (Array.isArray(value)) value.forEach(collectIndexes);
      else if (value && typeof value === 'object') collectIndexes(value);
    }
  }
  collectIndexes(stats.executionStages);
  return {
    returned: stats.nReturned,
    keysExamined: stats.totalKeysExamined,
    docsExamined: stats.totalDocsExamined,
    executionMs: stats.executionTimeMillis,
    indexes: [...indexes].sort(),
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
      Item.createIndexes(),
      Location.createIndexes(),
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
    let pairIndex = 0;
    for (const itemId of itemIds) {
      for (const locationId of locationIds) {
        const layerCount =
          pairIndex === 0
            ? PAGED_PAIR_LAYERS
            : pairIndex <= REDUCED_PAIR_COUNT
              ? LAYERS_PER_PAIR - 1
              : LAYERS_PER_PAIR;
        pairIndex += 1;
        balances.push({
          itemId,
          locationId,
          onHand: Types.Decimal128.fromString(String(layerCount)),
          reserved: zero,
          value: layerCount * 100,
          version: layerCount * 5,
          lastMovementAt: at,
        });
        for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
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
    const skuSearch = 'LOCAL-VOLUME-0999';
    const locationSearch = 'Local volume location 0';
    let pageStarted = performance.now();
    const skuBalances = await listStockBalances({ q: skuSearch, limit: 50 });
    const skuSearchMs = Math.round(performance.now() - pageStarted);
    pageStarted = performance.now();
    const locationFirst = await listStockBalances({ q: locationSearch, limit: 50 });
    const locationSearchMs = Math.round(performance.now() - pageStarted);
    const locationCursor = locationFirst.at(-1)?._id;
    if (!locationCursor) throw new Error('Location search did not return a cursor');
    const locationSecond = await listStockBalances({
      q: locationSearch,
      before: String(locationCursor),
      limit: 50,
    });
    const firstLocationIds = new Set(locationFirst.map((balance) => String(balance._id)));
    if (
      skuBalances.length !== LOCATION_COUNT ||
      skuBalances.some((balance) => String(balance.itemId?._id) !== String(itemIds.at(-1))) ||
      locationFirst.length !== 50 ||
      locationSecond.length !== 50 ||
      [...locationFirst, ...locationSecond].some(
        (balance) => String(balance.locationId?._id) !== String(locationId),
      ) ||
      locationSecond.some((balance) => firstLocationIds.has(String(balance._id)))
    ) {
      throw new Error('Local balance search or pagination returned unexpected records');
    }

    pageStarted = performance.now();
    const fifoFirst = await getFifoLayers(String(itemId), String(locationId), { limit: 50 });
    const fifoFirstMs = Math.round(performance.now() - pageStarted);
    const fifoCursor = fifoFirst.at(-1);
    if (!fifoCursor) throw new Error('FIFO first page did not return a cursor');
    pageStarted = performance.now();
    const fifoSecond = await getFifoLayers(String(itemId), String(locationId), {
      before: String(fifoCursor._id),
      limit: 50,
    });
    const fifoSecondMs = Math.round(performance.now() - pageStarted);
    const firstFifoIds = new Set(fifoFirst.map((layer) => String(layer._id)));
    if (
      fifoFirst.length !== 50 ||
      fifoSecond.length !== PAGED_PAIR_LAYERS - 50 ||
      fifoSecond.some((layer) => String(layer._id) <= String(fifoCursor._id)) ||
      fifoSecond.some((layer) => firstFifoIds.has(String(layer._id)))
    ) {
      throw new Error('Local FIFO pagination returned unexpected records');
    }

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
      fifoLayerNextPage: queryStats(
        await db
          .collection('cost_layers')
          .find({
            itemId,
            locationId,
            $or: [
              { receivedAt: { $gt: fifoCursor.receivedAt } },
              { receivedAt: fifoCursor.receivedAt, _id: { $gt: fifoCursor._id } },
            ],
          })
          .sort({ receivedAt: 1, _id: 1 })
          .limit(50)
          .explain('executionStats'),
      ),
      skuLookup: queryStats(
        await db
          .collection('items')
          .find({
            $or: [{ sku: new RegExp(skuSearch, 'i') }, { name: new RegExp(skuSearch, 'i') }],
          })
          .explain('executionStats'),
      ),
      skuBalancePage: queryStats(
        await db
          .collection('stock_balances')
          .find({
            $or: [{ itemId: { $in: [itemIds.at(-1)] } }, { locationId: { $in: [] } }],
          })
          .sort({ _id: -1 })
          .limit(50)
          .explain('executionStats'),
      ),
      locationLookup: queryStats(
        await db
          .collection('locations')
          .find({
            $or: [
              { code: new RegExp(locationSearch, 'i') },
              { name: new RegExp(locationSearch, 'i') },
            ],
          })
          .explain('executionStats'),
      ),
      locationBalancePage: queryStats(
        await db
          .collection('stock_balances')
          .find({
            $or: [{ itemId: { $in: [] } }, { locationId: { $in: [locationId] } }],
          })
          .sort({ _id: -1 })
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
        pages: {
          skuSearch: { returned: skuBalances.length, elapsedMs: skuSearchMs },
          locationSearch: {
            firstReturned: locationFirst.length,
            nextReturned: locationSecond.length,
            firstElapsedMs: locationSearchMs,
          },
          fifoLayers: {
            firstReturned: fifoFirst.length,
            nextReturned: fifoSecond.length,
            firstElapsedMs: fifoFirstMs,
            nextElapsedMs: fifoSecondMs,
          },
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
