import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staging deployment configuration', () => {
  it('targets only a separate staging Render service and branch', () => {
    const render = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
    expect(render).toContain('name: inventory-management-staging-backend');
    expect(render).toContain('branch: staging/security-audit');
    expect(render).toContain('autoDeployTrigger: off');
    expect(render).toContain('startCommand: npm run start:staging -w backend');
    expect(render).toContain('value: ims_staging');
    expect(render).not.toContain('branch: dfstock');
  });

  it('keeps preview API requests away from the production Render origin', () => {
    const vercel = JSON.parse(
      readFileSync(new URL('../../frontend/vercel.json', import.meta.url), 'utf8'),
    ) as {
      routes: { src: string; status: number }[];
      rewrites: { source: string; destination: string }[];
    };
    expect(vercel.routes).toContainEqual(
      expect.objectContaining({ src: '/api(?:/.*)?', status: 503 }),
    );
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
    expect(JSON.stringify(vercel)).not.toContain('onrender.com');
  });
});
