import process from 'node:process';

// This script runs only for a Vercel Preview build of an approved staging branch.
// Local normal frontend builds do not discover or bundle the server-side Function.
const stagingBranches = new Set(['staging/security-audit', 'integration/phase-2-security']);
if (
  process.env.VERCEL_ENV !== 'preview' ||
  !stagingBranches.has(process.env.VERCEL_GIT_COMMIT_REF)
) {
  process.stderr.write('Staging login gateway requires the protected staging Preview\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Staging login gateway build context verified\n');
}
