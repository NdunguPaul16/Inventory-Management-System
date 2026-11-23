import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { connectVolume, disconnectVolume, reportFailure } from './db.mjs';
import { assertVolumeTarget, expectedVolume, parseScale } from './guard.mjs';

function requireFixture(condition) {
  if (!condition) throw new Error('Fixture integrity check failed');
}

function pairKey(document) {
  return `${document.itemId}:${document.locationId}`;
}

export async function verifyFixture(db, scale) {
  const expected = expectedVolume(scale);
  const counts = {
    skus: await db.collection('items').countDocuments({}),
    locations: await db.collection('locations').countDocuments({}),
    balances: await db.collection('stock_balances').countDocuments({}),
    layers: await db.collection('cost_layers').countDocuments({}),
    movements: await db.collection('stock_movements').countDocuments({}),
  };
  for (const name of Object.keys(counts)) requireFixture(counts[name] === expected[name]);

  const itemIds = new Set();
  const skus = new Set();
  for await (const item of db.collection('items').find({})) {
    requireFixture(item.sku?.startsWith('VOLUME-') && !skus.has(item.sku));
    itemIds.add(String(item._id));
    skus.add(item.sku);
  }
  const locationIds = new Set();
  const locationCodes = new Set();
  for await (const location of db.collection('locations').find({})) {
    requireFixture(location.code?.startsWith('VOLUME-') && !locationCodes.has(location.code));
    locationIds.add(String(location._id));
    locationCodes.add(location.code);
  }
  const validPair = (document) =>
    itemIds.has(String(document.itemId)) && locationIds.has(String(document.locationId));

  const balances = new Map();
  for await (const balance of db.collection('stock_balances').find({})) {
    const key = pairKey(balance);
    requireFixture(validPair(balance) && !balances.has(key) && String(balance.reserved) === '0');
    balances.set(key, { quantity: Number(String(balance.onHand)), value: balance.value });
  }
  const layers = new Map();
  const layerTotals = new Map();
  for await (const layer of db.collection('cost_layers').find({})) {
    requireFixture(
      validPair(layer) &&
        layer.sourceDoc?.type === 'VOLUME_TEST' &&
        String(layer.originalQty) === '5' &&
        String(layer.remainingQty) === '1' &&
        layer.originalValue === 500 &&
        layer.remainingValue === 100 &&
        layer.unitCost === 100,
    );
    const id = String(layer._id);
    requireFixture(!layers.has(id));
    layers.set(id, { key: pairKey(layer), in: 0, out: 0 });
    const key = pairKey(layer);
    const previous = layerTotals.get(key) ?? { quantity: 0, value: 0 };
    previous.quantity += 1;
    previous.value += 100;
    layerTotals.set(key, previous);
  }

  const movementNumbers = new Set();
  const idempotencyKeys = new Set();
  const movementTotals = new Map();
  for await (const movement of db.collection('stock_movements').find({})) {
    const key = pairKey(movement);
    requireFixture(
      validPair(movement) &&
        movement.sourceDoc?.type === 'VOLUME_TEST' &&
        movement.movementNo?.startsWith('VOLUME-') &&
        !movementNumbers.has(movement.movementNo) &&
        !idempotencyKeys.has(movement.idempotencyKey) &&
        movement.unitCost === 100,
    );
    movementNumbers.add(movement.movementNo);
    idempotencyKeys.add(movement.idempotencyKey);
    const previous = movementTotals.get(key) ?? { quantity: 0, value: 0 };
    if (movement.direction === 'IN') {
      requireFixture(
        movement.movementType === 'OPENING' &&
          String(movement.quantity) === '5' &&
          movement.totalCost === 500,
      );
      const layer = layers.get(String(movement.layerCreated));
      requireFixture(layer?.key === key);
      layer.in += 1;
      previous.quantity += 5;
      previous.value += 500;
    } else {
      requireFixture(
        movement.direction === 'OUT' &&
          movement.movementType === 'ADJUSTMENT_OUT' &&
          String(movement.quantity) === '1' &&
          movement.totalCost === 100 &&
          movement.layersConsumed?.length === 1 &&
          String(movement.layersConsumed[0].quantity) === '1' &&
          movement.layersConsumed[0].totalCost === 100,
      );
      const layer = layers.get(String(movement.layersConsumed[0].layerId));
      requireFixture(layer?.key === key);
      layer.out += 1;
      previous.quantity -= 1;
      previous.value -= 100;
    }
    movementTotals.set(key, previous);
  }
  requireFixture(balances.size === expected.balances && layers.size === expected.layers);
  for (const layer of layers.values()) requireFixture(layer.in === 1 && layer.out === 4);
  for (const [key, balance] of balances) {
    const layer = layerTotals.get(key);
    const movement = movementTotals.get(key);
    requireFixture(
      layer?.quantity === balance.quantity &&
        movement?.quantity === balance.quantity &&
        layer?.value === balance.value &&
        movement?.value === balance.value,
    );
  }
  return counts;
}

async function main() {
  let connected = false;
  try {
    const scale = parseScale(process.argv.slice(2));
    const target = assertVolumeTarget(process.env, scale);
    const db = await connectVolume(target, 'read');
    connected = true;
    const counts = await verifyFixture(db, scale);
    process.stdout.write(
      `${JSON.stringify({ status: 'PASS', scale, database: target.dbName, counts })}\n`,
    );
  } catch {
    reportFailure('verification');
  } finally {
    if (connected) await disconnectVolume().catch(() => reportFailure('disconnect', 'execution'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
