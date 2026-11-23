import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const approvedTargetFile = new URL('./approved-target.json', import.meta.url);
function validAtlasHost(host) {
  return (
    typeof host === 'string' &&
    host.endsWith('.mongodb.net') &&
    host.length <= 253 &&
    host
      .split('.')
      .every(
        (label) =>
          label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  );
}

export function expectedVolume(scale) {
  if (scale === 10)
    return {
      skus: 100,
      locations: 5,
      balances: 500,
      layers: 2_000,
      movements: 10_000,
      dbName: 'ims_volume_trial',
    };
  if (scale === 100)
    return {
      skus: 1_000,
      locations: 5,
      balances: 5_000,
      layers: 20_000,
      movements: 100_000,
      dbName: 'ims_volume_full',
    };
  throw new Error('Only --scale=10 and --scale=100 are permitted');
}

export function parseScale(args) {
  if (args.length !== 1 || !/^--scale=(10|100)$/.test(args[0] ?? '')) {
    throw new Error('Exactly one --scale=10 or --scale=100 argument is required');
  }
  return Number(args[0].slice('--scale='.length));
}

export function readApprovedHost() {
  try {
    return JSON.parse(readFileSync(approvedTargetFile, 'utf8')).atlasSrvHost;
  } catch {
    throw new Error('Approved disposable Atlas target is unavailable');
  }
}

/** No network access occurs here. The checked-in approved-target.json is intentionally empty. */
export function assertVolumeTarget(source, scale, approvedHost = readApprovedHost(), options = {}) {
  const expected = expectedVolume(scale);
  const host = typeof approvedHost === 'string' ? approvedHost.trim().toLowerCase() : '';
  const stagingHost = source.STAGING_ATLAS_HOST?.trim().toLowerCase();
  const productionHost = source.PRODUCTION_ATLAS_HOST?.trim().toLowerCase();
  if (
    source.NODE_ENV !== 'production' ||
    !validAtlasHost(host) ||
    !validAtlasHost(stagingHost) ||
    !validAtlasHost(productionHost) ||
    new Set([host, stagingHost, productionHost]).size !== 3
  ) {
    throw new Error('Disposable Atlas target and distinct operational host pins are required');
  }
  if (
    source.MONGODB_DB_NAME !== expected.dbName ||
    (Object.hasOwn(options, 'dbName') && options.dbName !== expected.dbName)
  ) {
    throw new Error('Disposable database name does not match the selected scale');
  }
  if (!source.MONGODB_URI) throw new Error('Disposable Atlas URI is required');
  let uri;
  try {
    uri = new URL(source.MONGODB_URI);
  } catch {
    throw new Error('Disposable Atlas URI is invalid');
  }
  if (
    uri.protocol !== 'mongodb+srv:' ||
    uri.hostname.toLowerCase() !== host ||
    uri.port ||
    uri.pathname !== `/${expected.dbName}` ||
    uri.hash ||
    uri.searchParams.has('dbName') ||
    uri.searchParams.has('db')
  ) {
    throw new Error('Disposable Atlas URI does not match the approved target');
  }
  return { uri: source.MONGODB_URI, dbName: expected.dbName, expected, host };
}
