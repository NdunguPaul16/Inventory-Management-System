import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const backendDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = resolve(backendDir, '..');
const ordinaryDir = join(backendDir, 'dist');
const stagingDir = join(backendDir, 'dist-staging');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`,
  );
  return result;
}

function npm(...args) {
  assert.ok(process.env.npm_execpath, 'Run this check through npm');
  return run(process.execPath, [process.env.npm_execpath, ...args]);
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('normal and staging builds remain separate in both build orders', () => {
  npm('run', 'build:shared');
  npm('run', 'build:staging', '-w', 'backend');
  assert.ok(existsSync(join(stagingDir, 'staging', 'client-ip-diagnostic.js')));
  assert.ok(existsSync(join(stagingDir, 'staging', 'login-identity.js')));
  assert.match(
    readFileSync(join(stagingDir, 'staging', 'index.js'), 'utf8'),
    /client-ip-diagnostic\.js/,
  );

  // Simulate an old diagnostic artifact in the normal output before rebuilding.
  const staleDir = join(ordinaryDir, 'staging');
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(join(staleDir, 'client-ip-diagnostic.js'), 'stale diagnostic');
  npm('run', 'build', '-w', 'backend');
  assert.equal(existsSync(staleDir), false);
  assert.equal(existsSync(join(ordinaryDir, 'staging', 'login-identity.js')), false);
  assert.ok(existsSync(join(stagingDir, 'staging', 'client-ip-diagnostic.js')));
  for (const name of ['index.js', 'server.js', 'app.js']) {
    assert.doesNotMatch(readFileSync(join(ordinaryDir, name), 'utf8'), /client-ip-diagnostic/);
  }
  const wrongStagingStart = spawnSync(process.execPath, [join(ordinaryDir, 'index.js')], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      MONGODB_DB_NAME: 'ims_staging',
      MONGODB_URI: 'mongodb+srv://stage.example.test/',
      AUTH_RATE_LIMIT_REDIS_URL: 'redis://stage-kv.internal:6379',
      AUTH_ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-characters',
      AUTH_REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-characters',
    },
  });
  assert.equal(wrongStagingStart.status, 1);
  assert.match(wrongStagingStart.stderr, /Staging ingress build is required/);
  const ordinaryHash = hash(join(ordinaryDir, 'index.js'));

  npm('run', 'build:staging', '-w', 'backend');
  assert.equal(hash(join(ordinaryDir, 'index.js')), ordinaryHash);
  assert.ok(existsSync(join(stagingDir, 'staging', 'client-ip-diagnostic.js')));
  assert.match(readFileSync(join(stagingDir, 'staging', 'index.js'), 'utf8'), /runServer/);
});

test('output cleaner leaves unrelated directories untouched', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ims-build-artifacts-'));
  try {
    const scripts = join(fixture, 'backend', 'scripts');
    mkdirSync(scripts, { recursive: true });
    const cleaner = join(scripts, 'clean-output.mjs');
    copyFileSync(join(backendDir, 'scripts', 'clean-output.mjs'), cleaner);
    for (const name of ['dist', 'dist-staging', 'unrelated']) {
      const directory = join(fixture, 'backend', name);
      mkdirSync(directory);
      writeFileSync(join(directory, 'marker'), name);
    }
    run(process.execPath, [cleaner, 'dist'], { cwd: dirname(cleaner) });
    assert.equal(existsSync(join(fixture, 'backend', 'dist')), false);
    assert.ok(existsSync(join(fixture, 'backend', 'dist-staging', 'marker')));
    assert.ok(existsSync(join(fixture, 'backend', 'unrelated', 'marker')));
    run(process.execPath, [cleaner, 'dist-staging'], { cwd: dirname(cleaner) });
    assert.equal(existsSync(join(fixture, 'backend', 'dist-staging')), false);
    assert.ok(existsSync(join(fixture, 'backend', 'unrelated', 'marker')));
  } finally {
    assert.ok(resolve(fixture).startsWith(`${resolve(tmpdir())}${sep}`));
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('staging start script runs isolation preflight before starting the API', () => {
  const backend = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
  assert.equal(
    backend.scripts['start:staging'],
    'node dist-staging/cli/check-staging-env.js && node dist-staging/staging/index.js',
  );
  assert.ok(existsSync(join(stagingDir, 'cli', 'check-staging-env.js')));
  assert.ok(process.env.npm_execpath, 'Run this check through npm');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'run', 'start:staging', '-w', 'backend'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb+srv://stage.example.mongodb.net/',
        MONGODB_DB_NAME: 'ims', // Deliberately invalid: preflight must stop before networking.
        STAGING_ATLAS_HOST: 'stage.example.mongodb.net',
        PRODUCTION_ATLAS_HOST: 'production.example.mongodb.net',
        AUTH_RATE_LIMIT_REDIS_URL: 'redis://stage-kv.internal:6379',
        STAGING_KEY_VALUE_HOST: 'stage-kv.internal',
        AUTH_ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-characters',
        AUTH_REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-characters',
        AUTH_TRUSTED_PROXY_CIDRS: '',
      },
    },
  );
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Staging database name must be ims_staging/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /API listening|MongoDB connected/);
});
