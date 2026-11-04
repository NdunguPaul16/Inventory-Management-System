import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup/global-setup.ts'],
    setupFiles: ['test/setup/db.ts'],
    // Starting a replica set (and downloading mongod on first run) can be slow.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
