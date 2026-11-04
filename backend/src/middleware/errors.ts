import type { FastifyInstance } from 'fastify';
import { DatabaseError } from 'pg';
import { ZodError } from 'zod';
import { ApplicationError } from '../services/errors.js';

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

    // Drizzle wraps PostgreSQL errors in a query error.
    const databaseError =
      error instanceof DatabaseError
        ? error
        : error instanceof Error && error.cause instanceof DatabaseError
          ? error.cause
          : undefined;

    if (databaseError && ['23503', '23505', '23514'].includes(databaseError.code ?? '')) {
      request.log.warn({ code: databaseError.code }, 'Database constraint rejected the request');
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
