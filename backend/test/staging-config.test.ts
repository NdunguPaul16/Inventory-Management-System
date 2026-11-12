import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staging deployment configuration', () => {
  it('targets only a separate staging Render service and branch', () => {
    const render = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
    const backend = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: { start: string; 'start:staging': string } };
    expect(render).toContain('name: inventory-management-staging-backend');
    expect(render).toContain('branch: staging/security-audit');
    expect(render).toContain('autoDeployTrigger: off');
    expect(render).toContain('startCommand: npm run start:staging -w backend');
    expect(render).toContain('value: ims_staging');
    expect(render).not.toContain('branch: dfstock');
    expect(backend.scripts.start).toBe('npm run start:staging');
    expect(backend.scripts['start:staging']).toContain('check-staging-env.js');
  });

  it('keeps preview API requests away from the production Render origin', () => {
    const vercel = JSON.parse(
      readFileSync(new URL('../../frontend/vercel.json', import.meta.url), 'utf8'),
    ) as {
      framework: string;
      installCommand: string;
      buildCommand: string;
      outputDirectory: string;
      git: { deploymentEnabled: Record<string, boolean> };
      routes?: { src: string; status: number }[];
      rewrites: { source: string; destination: string }[];
    };
    expect(vercel.framework).toBe('vite');
    expect(vercel.installCommand).toBe('npm ci --include=dev --prefix ..');
    expect(vercel.buildCommand).toBe('npm run build:shared --prefix .. && npm run build');
    expect(vercel.outputDirectory).toBe('dist');
    expect(vercel.routes).toBeUndefined();
    expect(vercel.git.deploymentEnabled).toEqual({ 'staging/security-audit': false });
    expect(vercel.rewrites).toEqual([
      {
        source: '/api/:path*',
        destination: 'https://inventory-inc-staging-backend.onrender.com/api/:path*',
      },
      { source: '/(.*)', destination: '/index.html' },
    ]);
    expect(JSON.stringify(vercel)).not.toContain('inventory-management-backend-jn2c.onrender.com');
  });
});
