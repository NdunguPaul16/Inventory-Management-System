import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const expected =
  process.argv[2] === 'auto'
    ? process.env.VERCEL_ENV === 'preview' &&
      process.env.VERCEL_GIT_COMMIT_REF === 'staging/security-audit'
    : process.argv[2] === 'staging';

const textExtensions = new Set(['.js', '.html', '.css', '.map', '.json']);

async function artifactTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return artifactTextFiles(path);
      return entry.isFile() &&
        [...textExtensions].some((extension) => entry.name.endsWith(extension))
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

const files = await artifactTextFiles(fileURLToPath(new URL('../dist/', import.meta.url)));
if (files.length === 0) throw new Error('No frontend build artifact found');
const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
const markers = [
  '/api/v1/internal/client-ip-diagnostic',
  'Temporary staging client-IP diagnostic',
  'Send one diagnostic GET',
  'restore your session through the normal authentication endpoints',
  'Client IP diagnostic request failed',
  'socketPeerId',
  'expressClientId',
  'forwardedHopCount',
];
const included = markers.map((marker) => contents.some((source) => source.includes(marker)));
const serverOnlyMarkers = [
  'ims-login-v1',
  'x-ims-staging-login-assertion',
  'STAGING_LOGIN_GATEWAY_KEY_CURRENT',
];
if (serverOnlyMarkers.some((marker) => contents.some((source) => source.includes(marker)))) {
  throw new Error('Server-side staging login gateway leaked into the frontend artifact');
}
if (included.some((present) => present !== expected)) {
  throw new Error(
    expected
      ? 'Staging diagnostic missing from artifact'
      : 'Diagnostic leaked into normal artifact',
  );
}
process.stdout.write(
  expected ? 'Staging diagnostic artifact verified\n' : 'Normal artifact excludes diagnostic\n',
);
