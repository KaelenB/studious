import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createApiClient } from '@studious/api';
import { openNodeDatabase } from '../src/db/node.js';
import { buildApp } from '../src/app.js';

it('downloads a consistent standalone database including committed WAL data and all households', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studious-backup-test-'));
  const connection = openNodeDatabase(join(directory, 'source.sqlite'));
  const app = buildApp(connection, false);
  try {
    await connection.migrate();
    const api = createApiClient(await app.listen({ host: '127.0.0.1', port: 0 }));
    await api.createHousehold('First household', 'CAD');
    await api.createHousehold('Second household', 'USD');
    const response = await app.inject({ method: 'GET', url: '/database/backup' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="studious-.*\.sqlite"/,
    );
    expect(response.rawPayload.subarray(0, 16).toString()).toBe('SQLite format 3\0');
    const path = join(directory, 'download.sqlite');
    await writeFile(path, response.rawPayload);
    const restored = new DatabaseSync(path);
    try {
      expect(restored.prepare('PRAGMA integrity_check').get()).toMatchObject({
        integrity_check: 'ok',
      });
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(restored.prepare('SELECT count(*) AS count FROM households').get()).toMatchObject({
        count: 2,
      });
    } finally {
      restored.close();
    }
    await expect
      .poll(async () => {
        try {
          const blob = await api.downloadDatabase();
          expect(blob.type).toBe('application/vnd.sqlite3');
          return blob.size;
        } catch (error) {
          if (error instanceof Error && 'status' in error && error.status === 503) return 0;
          throw error;
        }
      })
      .toBeGreaterThan(0);
    expect((await api.createHousehold('After backup', 'CAD')).name).toBe('After backup');
  } finally {
    await app.close();
    await connection.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('reports backup failures and allows retry after failure', async () => {
  const connection = openNodeDatabase(':memory:');
  await connection.migrate();
  const snapshot = connection.snapshot;
  connection.snapshot = async () => {
    throw new Error('Backup unavailable');
  };
  const app = buildApp(connection, false);
  try {
    expect((await app.inject('/database/backup')).statusCode).toBe(500);
    connection.snapshot = snapshot;
    expect((await app.inject('/database/backup')).statusCode).toBe(200);
  } finally {
    await app.close();
    await connection.close();
  }
});

it('rejects overlapping snapshots with an explicit retryable response', async () => {
  const connection = openNodeDatabase(':memory:');
  await connection.migrate();
  const snapshot = connection.snapshot;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  connection.snapshot = async (path) => {
    started();
    await waiting;
    return snapshot(path);
  };
  const app = buildApp(connection, false);
  try {
    const first = app.inject('/database/backup').then((response) => response);
    await ready;
    const second = await app.inject('/database/backup');
    expect(second.statusCode).toBe(503);
    expect(second.headers['retry-after']).toBe('5');
    release();
    expect((await first).statusCode).toBe(200);
  } finally {
    release();
    await app.close();
    await connection.close();
  }
});
