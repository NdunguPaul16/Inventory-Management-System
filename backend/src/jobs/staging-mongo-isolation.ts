/** The Cron job needs MongoDB only; the web-service Key Value guard is unchanged. */
export function assertStagingMongoIsolation(source: NodeJS.ProcessEnv): {
  uri: string;
  dbName: 'ims_staging';
} {
  if (source.NODE_ENV !== 'production') throw new Error('Staging requires production runtime mode');
  if (source.MONGODB_DB_NAME !== 'ims_staging')
    throw new Error('Staging database name must be ims_staging');

  const stagingHost = source.STAGING_ATLAS_HOST?.trim().toLowerCase();
  const productionHost = source.PRODUCTION_ATLAS_HOST?.trim().toLowerCase();
  if (
    !stagingHost ||
    !productionHost ||
    !/^[a-z0-9.-]+\.mongodb\.net$/.test(stagingHost) ||
    !/^[a-z0-9.-]+\.mongodb\.net$/.test(productionHost) ||
    stagingHost === productionHost
  ) {
    throw new Error('Distinct staging and production Atlas host pins are required');
  }

  const uri = source.MONGODB_URI;
  if (!uri) throw new Error('Staging MongoDB URL is required');
  let target: URL;
  try {
    target = new URL(uri);
  } catch {
    throw new Error('Staging MongoDB URL is invalid');
  }
  if (
    target.protocol !== 'mongodb+srv:' ||
    target.hostname.toLowerCase() !== stagingHost ||
    target.port ||
    (target.pathname !== '' && target.pathname !== '/' && target.pathname !== '/ims_staging')
  ) {
    throw new Error('Staging MongoDB URL does not match the isolated Atlas target');
  }
  return { uri, dbName: 'ims_staging' };
}
