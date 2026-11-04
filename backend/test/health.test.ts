import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from '@ims/shared';
import { createTestApp } from './helpers.js';

const app = createTestApp();

describe('GET /api/v1/health', () => {
  it('reports the app and an up database in the success envelope', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    const body = healthResponseSchema.parse(res.body);
    expect(body.data.status).toBe('ok');
    expect(body.data.app.name).toBe('@ims/server');
    expect(body.data.app.environment).toBe('test');
    expect(body.data.db).toMatchObject({ status: 'up', state: 'connected' });
    expect(body.data.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets a request id header, reusing a valid incoming one', async () => {
    const generated = await request(app).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]+$/);

    const reused = await request(app).get('/api/v1/health').set('x-request-id', 'abc-123');
    expect(reused.headers['x-request-id']).toBe('abc-123');
  });

  it('returns 404 in the error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('renders malformed JSON bodies as BAD_REQUEST', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"oops":')
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  // Keep last: it closes this file's connection.
  it('returns 503 "degraded" when the database is down', async () => {
    await mongoose.disconnect();
    const res = await request(app).get('/api/v1/health').expect(503);

    const body = healthResponseSchema.parse(res.body);
    expect(body.data.status).toBe('degraded');
    expect(body.data.db).toEqual({ status: 'down', state: 'disconnected', latencyMs: null });
  });
});
