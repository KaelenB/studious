import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerApi } from './api.js';
import type { DatabaseConnection } from './db/database.js';
import type { DocumentExtractors } from './services/extractors.js';
import { nodeExtractors } from './services/extractors.node.js';

export function buildApp(
  connection: DatabaseConnection,
  logger: boolean | { level: string } = true,
  corsOrigins: string[] = [],
  extractors: DocumentExtractors = nodeExtractors,
) {
  const app = Fastify({ logger, bodyLimit: 65536 });
  if (corsOrigins.length) {
    // Allows a separately hosted static frontend to call this API.
    void app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    });
  }
  return registerApi(app, connection, extractors);
}
