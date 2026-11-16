import process from 'node:process';

// This script runs only for a Vercel build of the staging branch. Local normal
// frontend builds do not discover or bundle the server-side login Function.
if (
  process.env.VERCEL_ENV !== 'preview' ||
  process.env.VERCEL_GIT_COMMIT_REF !== 'staging/security-audit'
) {
  process.stderr.write('Staging login gateway requires the protected staging Preview\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Staging login gateway build context verified\n');
}
