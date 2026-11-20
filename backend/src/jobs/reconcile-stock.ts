import { connectDb, disconnectDb } from '../config/db.js';
import { loadEnvFile, parseEnv } from '../config/env.js';
import { reconcileBalances } from '../modules/inventory/engine/service.js';

/** Read-only job entry point for an external nightly scheduler. */
async function main(): Promise<void> {
  let connected = false;
  try {
    loadEnvFile();
    const env = parseEnv(process.env);
    if (!env.MONGODB_URI || !process.env.MONGODB_DB_NAME) {
      throw new Error('Database configuration is incomplete');
    }

    await connectDb(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, autoIndex: false });
    connected = true;

    const result = await reconcileBalances();
    process.stdout.write(
      `Stock reconciliation ${new Date().toISOString()}: checked=${result.checked}, differences=${result.differences.length}\n`,
    );
    if (result.differences.length > 0) process.exitCode = 2;
  } catch {
    process.stderr.write('Stock reconciliation failed; no stock records were changed.\n');
    process.exitCode = 1;
  } finally {
    if (connected) {
      await disconnectDb().catch(() => {
        process.stderr.write('Stock reconciliation could not close the database connection.\n');
        process.exitCode = 1;
      });
    }
  }
}

void main();
