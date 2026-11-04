import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, z } from '@ims/shared';
import { AppError } from '../src/lib/errors.js';
import { createErrorHandler, notFoundHandler } from '../src/middleware/error-handler.js';
import { validate } from '../src/middleware/validate.js';
import { silentLogger } from './helpers.js';

function buildApp(exposeInternalErrors = false) {
  const app = express();
  app.use(pinoHttp({ logger: silentLogger }));
  app.use(express.json());
  app.post(
    '/things/:id',
    validate({
      params: z.object({ id: z.string().regex(/^\d+$/) }),
      body: z.object({ name: z.string().min(1), qty: z.coerce.number().int().positive() }),
    }),
    (req, res) => {
      res
        .status(201)
        .json({ data: { body: req.body, params: res.locals.validated?.params }, meta: {} });
    },
  );
  app.get('/conflict', () => {
    throw AppError.conflict('Already posted', { docNumber: 'GRN-2026-00001' });
  });
  app.get('/duplicate', () => {
    throw Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyValue: { sku: 'A' } });
  });
  app.get('/boom', async () => {
    await Promise.resolve();
    throw new Error('secret internals');
  });
  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeInternalErrors }));
  return app;
}

describe('validate middleware + error handler', () => {
  const app = buildApp();

  it('passes parsed values through', async () => {
    const res = await request(app).post('/things/7').send({ name: 'Cue', qty: '3' }).expect(201);
    expect(res.body.data).toEqual({ body: { name: 'Cue', qty: 3 }, params: { id: '7' } });
  });

  it('renders zod failures as VALIDATION_ERROR with details', async () => {
    const res = await request(app).post('/things/x').send({ name: '' }).expect(400);
    const { error } = apiErrorSchema.parse(res.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'id' })]),
    );
  });

  it('renders malformed JSON as BAD_REQUEST', async () => {
    const res = await request(app)
      .post('/things/1')
      .set('content-type', 'application/json')
      .send('{"name":')
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('renders AppError with its status, code and details', async () => {
    const res = await request(app).get('/conflict').expect(409);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Already posted',
        details: { docNumber: 'GRN-2026-00001' },
      },
    });
  });

  it('maps Mongo duplicate keys to CONFLICT', async () => {
    const res = await request(app).get('/duplicate').expect(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { sku: 'A' } });
  });

  it('hides internal error messages unless exposure is enabled', async () => {
    const hidden = await request(app).get('/boom').expect(500);
    expect(hidden.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });

    const shown = await request(buildApp(true)).get('/boom').expect(500);
    expect(shown.body.error.message).toBe('secret internals');
  });

  it('renders unknown routes as NOT_FOUND', async () => {
    const res = await request(app).get('/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
