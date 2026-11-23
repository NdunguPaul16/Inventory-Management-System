import { Types } from 'mongoose';
import { expectedVolume } from './guard.mjs';

const one = Types.Decimal128.fromString('1');
const five = Types.Decimal128.fromString('5');
const zero = Types.Decimal128.fromString('0');
const at = new Date('2026-01-01T00:00:00.000Z');

function objectId(kind, number) {
  return new Types.ObjectId(
    `${kind.toString(16).padStart(2, '0')}${number.toString(16).padStart(22, '0')}`,
  );
}

/** Same four-layers-per-pair geometry and 75-layer pagination outlier as the local benchmark. */
export function* fixtureBatches(scale, batchSize = 1_000) {
  const expected = expectedVolume(scale);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error('Fixture batch size must be between 1 and 1000');
  }
  const items = Array.from({ length: expected.skus }, (_, i) => objectId(1, i + 1));
  const locations = Array.from({ length: expected.locations }, (_, i) => objectId(2, i + 1));
  const itemDocuments = items.map((_id, index) => ({
    _id,
    sku: `VOLUME-${String(index).padStart(4, '0')}`,
    name: `Volume test item ${index}`,
    type: 'TRADING_GOOD',
    baseUnit: 'PCS',
    isActive: true,
  }));
  for (let offset = 0; offset < itemDocuments.length; offset += batchSize) {
    yield { collection: 'items', documents: itemDocuments.slice(offset, offset + batchSize) };
  }
  const locationDocuments = locations.map((_id, index) => ({
    _id,
    code: `VOLUME-${index}`,
    name: `Volume test location ${index}`,
    type: 'WAREHOUSE',
    isActive: true,
  }));
  for (let offset = 0; offset < locationDocuments.length; offset += batchSize) {
    yield {
      collection: 'locations',
      documents: locationDocuments.slice(offset, offset + batchSize),
    };
  }

  const buffers = { stock_balances: [], cost_layers: [], stock_movements: [] };
  let layerNumber = 0;
  let movementNumber = 0;
  let pairNumber = 0;
  const postedBy = objectId(4, 1);
  for (const itemId of items) {
    for (const locationId of locations) {
      const layerCount = pairNumber === 0 ? 75 : pairNumber <= 71 ? 3 : 4;
      pairNumber += 1;
      buffers.stock_balances.push({
        _id: objectId(5, pairNumber),
        itemId,
        locationId,
        onHand: Types.Decimal128.fromString(String(layerCount)),
        reserved: zero,
        value: layerCount * 100,
        version: layerCount * 5,
        lastMovementAt: at,
      });
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        layerNumber += 1;
        const layerId = objectId(3, layerNumber);
        const sourceId = `VOLUME-${layerNumber}`;
        buffers.cost_layers.push({
          _id: layerId,
          itemId,
          locationId,
          sourceDoc: { type: 'VOLUME_TEST', id: sourceId, number: sourceId },
          receivedAt: at,
          originalQty: five,
          remainingQty: one,
          originalValue: 500,
          remainingValue: 100,
          unitCost: 100,
          costHistory: [],
        });
        movementNumber += 1;
        buffers.stock_movements.push({
          _id: objectId(6, movementNumber),
          movementNo: `VOLUME-${movementNumber}`,
          itemId,
          locationId,
          direction: 'IN',
          quantity: five,
          movementType: 'OPENING',
          unitCost: 100,
          totalCost: 500,
          layerCreated: layerId,
          sourceDoc: { type: 'VOLUME_TEST', id: sourceId, number: sourceId },
          serialNumbers: [],
          idempotencyKey: `VOLUME-${movementNumber}`,
          postedAt: at,
          postedBy,
        });
        for (let issue = 0; issue < 4; issue += 1) {
          movementNumber += 1;
          buffers.stock_movements.push({
            _id: objectId(6, movementNumber),
            movementNo: `VOLUME-${movementNumber}`,
            itemId,
            locationId,
            direction: 'OUT',
            quantity: one,
            movementType: 'ADJUSTMENT_OUT',
            unitCost: 100,
            totalCost: 100,
            layersConsumed: [{ layerId, quantity: one, unitCost: 100, totalCost: 100 }],
            sourceDoc: {
              type: 'VOLUME_TEST',
              id: `VOLUME-${movementNumber}`,
              number: `VOLUME-${movementNumber}`,
            },
            serialNumbers: [],
            idempotencyKey: `VOLUME-${movementNumber}`,
            postedAt: at,
            postedBy,
          });
        }
      }
      for (const collection of Object.keys(buffers)) {
        while (buffers[collection].length >= batchSize) {
          yield { collection, documents: buffers[collection].splice(0, batchSize) };
        }
      }
    }
  }
  for (const collection of Object.keys(buffers)) {
    if (buffers[collection].length) yield { collection, documents: buffers[collection] };
  }
}
