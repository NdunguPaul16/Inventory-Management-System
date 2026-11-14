import { existsSync, lstatSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = fileURLToPath(new URL('../', import.meta.url));
const outputName = process.argv[2];
if (outputName !== 'dist' && outputName !== 'dist-staging') {
  throw new Error('Expected a known backend build output');
}

const target = resolve(backendDir, outputName);
if (dirname(target) !== resolve(backendDir)) {
  throw new Error('Build output is outside the backend workspace');
}
if (existsSync(target)) {
  if (lstatSync(target).isSymbolicLink()) throw new Error('Build output must not be a symlink');
  rmSync(target, { recursive: true, force: true });
}
