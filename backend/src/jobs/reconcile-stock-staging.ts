import { loadEnvFile } from '../config/env.js';
import { runStockReconciliation } from './reconciliation-runner.js';

loadEnvFile();
const result = await runStockReconciliation(process.env, true);
if (result.checked !== undefined) {
  process.stdout.write(
    `Stock reconciliation ${new Date().toISOString()}: checked=${result.checked}, differences=${result.differences}, elapsedMs=${result.elapsedMs}\n`,
  );
}
if (result.exitCode === 1) {
  process.stderr.write('Stock reconciliation failed; no stock records were changed.\n');
}
process.exitCode = result.exitCode;
