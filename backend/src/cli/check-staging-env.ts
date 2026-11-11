import { loadEnvFile } from '../config/env.js';
import { assertStagingIsolation } from '../config/staging-isolation.js';

loadEnvFile();
try {
  assertStagingIsolation(process.env);
  // eslint-disable-next-line no-console
  console.info('Staging isolation check passed');
} catch (error) {
  // Never print connection strings or credentials from an invalid environment.
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : 'Staging isolation check failed');
  process.exitCode = 1;
}
