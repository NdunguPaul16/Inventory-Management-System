import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z, type ApiError } from '@ims/shared';
import { AppError } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
};

function isMongoDuplicateKey(err: unknown): err is { code: 11000; keyValue?: unknown } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function isJsonParseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === 'entity.parse.failed'
  );
}

/** Renders every error as `{ error: { code, message, details } }` (spec §2.2). */
export function createErrorHandler(options: {
  exposeInternalErrors: boolean;
}): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let status = 500;
    let body: ApiError['error'] = { code: 'INTERNAL_ERROR', message: 'Internal server error' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof z.ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      };
    } else if (isMongoDuplicateKey(err)) {
      status = 409;
      body = { code: 'CONFLICT', message: 'Duplicate value', details: err.keyValue };
    } else if (isJsonParseError(err)) {
      status = 400;
      body = { code: 'BAD_REQUEST', message: 'Malformed JSON body' };
    } else if (options.exposeInternalErrors && err instanceof Error) {
      body.message = err.message;
    }

    if (status >= 500) req.log.error({ err }, 'Unhandled error');
    else req.log.warn({ code: body.code, status }, body.message);

    if (body.details === undefined) delete body.details;
    res.status(status).json({ error: body });
  };
}
