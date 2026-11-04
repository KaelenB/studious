import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApplicationError } from '../services/errors.js';
import { DatabaseConstraintError, StorageLimitError, databaseError } from '../db/errors.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, 'Request validation failed');
      return reply.code(400).send({ error: 'Validation failed', issues: error.issues });
    }

    if (error instanceof ApplicationError) {
      request.log.warn({ code: error.code }, error.message);
      return reply.code(error.code === 'NOT_FOUND' ? 404 : 409).send({ error: error.message });
    }

    // Drizzle wraps driver errors in a query error.
    const storageError = databaseError(error);
    if (storageError instanceof StorageLimitError) {
      request.log.warn({ limitBytes: storageError.limitBytes }, 'Storage limit reached');
      return reply.code(507).send({
        error: `${storageError.message}`,
      });
    }
    if (storageError instanceof DatabaseConstraintError) {
      request.log.warn('Database constraint rejected the request');
      return reply
        .code(409)
        .send({ error: 'Data conflicts with an existing record or relationship' });
    }

    const statusCode =
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    request.log.error({ err: error }, 'Request failed');
    return reply.code(statusCode).send({
      error:
        statusCode === 500 || !(error instanceof Error) ? 'Internal server error' : error.message,
    });
  });
}
