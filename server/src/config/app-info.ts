import { readFileSync } from 'node:fs';

// src/config and dist/config both sit two levels below server/package.json.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

export const appInfo = { name: pkg.name, version: pkg.version } as const;
