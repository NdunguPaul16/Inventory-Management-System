import type { RequestHandler } from 'express';
import type { z } from '@ims/shared';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare module 'express-serve-static-core' {
  interface Locals {
    validated?: Validated;
  }
}

/**
 * Validates the request against zod schemas from `@ims/shared` (CLAUDE.md rule 8).
 * Parsed values are stored on `res.locals.validated`, and `req.body` is replaced by the
 * parsed body. A failure is passed on as a ZodError and rendered as `VALIDATION_ERROR`.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const validated: Validated = {};
    if (schemas.params) validated.params = schemas.params.parse(req.params);
    if (schemas.query) validated.query = schemas.query.parse(req.query);
    if (schemas.body) req.body = validated.body = schemas.body.parse(req.body);
    res.locals.validated = validated;
    next();
  };
}
