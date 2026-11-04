import { readFileSync } from 'node:fs';

// src/config and dist/config both sit two levels below backend/package.json.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Keep the health response identifier stable across the workspace directory rename.
export const appInfo = { name: '@ims/server', version: pkg.version } as const;
