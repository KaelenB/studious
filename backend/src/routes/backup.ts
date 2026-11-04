import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../db/database.js';

export function registerBackupRoutes(app: FastifyInstance, connection: DatabaseConnection) {
  let busy = false;
  app.get('/database/backup', async (request, reply) => {
    if (busy) {
      request.log.warn('Database backup already in progress');
      return reply
        .code(503)
        .header('Retry-After', '5')
        .send({ error: 'A database download is already in progress. Try again shortly.' });
    }
    busy = true;
    let directory: string | undefined;
    const cleanup = async () => {
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        busy = false;
      }
    };
    try {
      directory = await mkdtemp(join(tmpdir(), 'studious-backup-'));
      const path = join(directory, 'studious.sqlite');
      await connection.snapshot(path);
      const { size } = await stat(path);
      const stream = createReadStream(path);
      stream.once('close', () => {
        void cleanup().catch((err: unknown) =>
          request.log.error({ err }, 'Could not remove database backup'),
        );
      });
      return reply
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="studious-${new Date().toISOString().slice(0, 10)}.sqlite"`,
        )
        .header('Content-Length', size)
        .type('application/vnd.sqlite3')
        .send(stream);
    } catch (error) {
      await cleanup();
      throw error;
    }
  });
}
