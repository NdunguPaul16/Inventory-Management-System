import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from '../src/index.js';

describe('shared schemas', () => {
  it('accepts a valid health envelope', () => {
    const parsed = healthResponseSchema.parse({
      data: {
        status: 'ok',
        app: { name: 'ims-server', version: '0.1.0', environment: 'test', uptimeSeconds: 1 },
        db: { status: 'up', state: 'connected', latencyMs: 2 },
        time: new Date().toISOString(),
      },
      meta: {},
    });
    expect(parsed.data.db.status).toBe('up');
  });

  it('rejects a health payload with an unknown db status', () => {
    const result = healthResponseSchema.safeParse({
      data: {
        status: 'ok',
        app: { name: 'x', version: '1', environment: 'test', uptimeSeconds: 0 },
        db: { status: 'maybe', state: 'connected', latencyMs: null },
        time: new Date().toISOString(),
      },
      meta: {},
    });
    expect(result.success).toBe(false);
  });

  it('parses the error envelope', () => {
    const parsed = apiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'Nope' } });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });
});
