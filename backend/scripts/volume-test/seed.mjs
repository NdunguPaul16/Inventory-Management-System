import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { Item } from '../../dist-staging/modules/inventory/items/model.js';
import { Location } from '../../dist-staging/modules/inventory/locations/model.js';
import {
  CostLayer,
  StockBalance,
  StockMovement,
} from '../../dist-staging/modules/inventory/engine/models.js';
import { connectVolume, disconnectVolume, reportFailure } from './db.mjs';
import { fixtureBatches } from './fixture.mjs';
import { assertVolumeTarget, parseScale } from './guard.mjs';

export async function seedFixture(db, scale, createIndexes = async () => {}) {
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length !== 0) throw new Error('Target database must have no collections');
  await createIndexes();
  const inserted = {
    items: 0,
    locations: 0,
    stock_balances: 0,
    cost_layers: 0,
    stock_movements: 0,
  };
  for (const { collection, documents } of fixtureBatches(scale)) {
    await db.collection(collection).insertMany(documents, { ordered: true });
    inserted[collection] += documents.length;
  }
  return inserted;
}

async function main() {
  let connected = false;
  try {
    const scale = parseScale(process.argv.slice(2));
    const target = assertVolumeTarget(process.env, scale);
    const db = await connectVolume(target, 'readWrite');
    connected = true;
    const counts = await seedFixture(db, scale, async () => {
      await Item.createIndexes();
      await Location.createIndexes();
      await StockBalance.createIndexes();
      await CostLayer.createIndexes();
      await StockMovement.createIndexes();
    });
    process.stdout.write(
      `${JSON.stringify({ status: 'SEEDED', scale, database: target.dbName, counts })}\n`,
    );
  } catch {
    reportFailure('seed');
  } finally {
    if (connected) await disconnectVolume().catch(() => reportFailure('disconnect', 'execution'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
