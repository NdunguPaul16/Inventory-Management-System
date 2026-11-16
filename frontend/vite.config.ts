/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { diagnosticBuildEnabled } from './diagnostic-build-gate.ts';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig(({ command, mode }) => {
  const stagingDiagnostic = diagnosticBuildEnabled({
    command,
    mode,
    vercelEnvironment: process.env.VERCEL_ENV,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
  });
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '#staging-routes': stagingDiagnostic
          ? fileURLToPath(new URL('./src/app/staging-routes.tsx', import.meta.url))
          : fileURLToPath(new URL('./src/app/empty-staging-routes.ts', import.meta.url)),
        '#auth-extension': stagingDiagnostic
          ? fileURLToPath(
              new URL('./src/modules/staging-diagnostic/auth-extension.ts', import.meta.url),
            )
          : fileURLToPath(
              new URL('./src/modules/staging-diagnostic/empty-auth-extension.ts', import.meta.url),
            ),
      },
    },
    // One .env at the repo root serves both frontend and backend.
    envDir: '..',
    server: {
      port: 5173,
      // The API is same-origin in the browser; Vite forwards /api to Express in development.
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      maxWorkers: 1,
      include: ['test/**/*.test.{ts,tsx}'],
      setupFiles: ['test/setup.ts'],
    },
  };
});
