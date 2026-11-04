import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '../models/schema.js';
import { migrations } from './migrations.generated.js';

/** Default and maximum database size: the whole household archive must fit in 1 GiB. */
export const defaultStorageLimitBytes = 1024 * 1024 * 1024;

export type QueryMethod = 'run' | 'all' | 'values' | 'get';

/**
 * Minimal SQLite connection contract implemented by node:sqlite (server) and SQLite WASM
 * (browser). Every method returns a list of positional row arrays (empty for `run`).
 */
export interface SqliteDriver {
  query(sql: string, params: unknown[], method: QueryMethod): Promise<unknown[]>;
  close(): Promise<void>;
}

function createLock() {
  let tail = Promise.resolve();
  return <T>(work: () => Promise<T>) => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createDatabase(driver: SqliteDriver) {
  const exclusive = createLock();
  const execute = async (sql: string, params: unknown[], method: QueryMethod) => {
    const rows = await driver.query(sql, params, method);
    return { rows: method === 'get' ? rows[0] : rows } as { rows: unknown[] };
  };
  // One connection is shared: standalone statements queue behind open transactions, while
  // statements issued through a transaction handle run immediately inside it.
  const db = drizzle((sql, params, method) => exclusive(() => execute(sql, params, method)), {
    schema,
  });
  const transactional = drizzle(execute, { schema });
  const transaction: typeof db.transaction = (work, config) =>
    exclusive(() =>
      transactional.transaction((tx) => work(tx as unknown as Parameters<typeof work>[0]), config),
    );
  db.transaction = transaction;

  return {
    db,
    driver,
    snapshot: (destination: string) =>
      exclusive(() => driver.query('VACUUM INTO ?', [destination], 'run')),
    async storage() {
      const [pageCount] = (await driver.query('PRAGMA page_count', [], 'get')) as [number[]];
      const [pageSize] = (await driver.query('PRAGMA page_size', [], 'get')) as [number[]];
      const [maxPages] = (await driver.query('PRAGMA max_page_count', [], 'get')) as [number[]];
      return {
        usedBytes: pageCount![0]! * pageSize![0]!,
        limitBytes: maxPages![0]! * pageSize![0]!,
      };
    },
    async migrate() {
      await exclusive(async () => {
        await driver.query(
          'CREATE TABLE IF NOT EXISTS __studious_migrations (tag TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)',
          [],
          'run',
        );
        const applied = new Map(
          (
            (await driver.query('SELECT tag, hash FROM __studious_migrations', [], 'all')) as [
              string,
              string,
            ][]
          ).map(([tag, hash]) => [tag, hash]),
        );
        for (const migration of migrations) {
          const hash = applied.get(migration.tag);
          if (hash === migration.hash) continue;
          if (hash) throw new Error(`Migration ${migration.tag} changed after it was applied.`);
          await driver.query('BEGIN IMMEDIATE', [], 'run');
          try {
            for (const statement of migration.statements) await driver.query(statement, [], 'run');
            await driver.query(
              'INSERT INTO __studious_migrations (tag, hash, applied_at) VALUES (?, ?, ?)',
              [migration.tag, migration.hash, Date.now()],
              'run',
            );
            await driver.query('COMMIT', [], 'run');
          } catch (error) {
            await driver.query('ROLLBACK', [], 'run');
            throw error;
          }
        }
      });
    },
    close: () => driver.close(),
  };
}

/** Pragmas every connection needs: integrity checks, plus the hard size cap. */
export function connectionPragmas(pageSize: number, limitBytes: number) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 16 * 1024 * 1024)
    throw new Error('The storage limit must be at least 16 MiB.');
  return [
    'PRAGMA foreign_keys = ON',
    `PRAGMA max_page_count = ${Math.floor(limitBytes / pageSize)}`,
  ];
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection['db'];
