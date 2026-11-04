import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  connectionPragmas,
  createDatabase,
  defaultStorageLimitBytes,
  type SqliteDriver,
} from './database.js';
import { sqliteError } from './errors.js';

/** Opens a SQLite file (or `:memory:`) with node:sqlite, capped at `limitBytes`. */
export function openNodeDatabase(path: string, limitBytes = defaultStorageLimitBytes) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const pageSize = (sqlite.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
  for (const pragma of connectionPragmas(pageSize, limitBytes)) sqlite.exec(pragma);

  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      if (statements.size > 500) statements.clear();
      statements.set(sql, statement);
    }
    return statement;
  };

  const driver: SqliteDriver = {
    async query(sql, params, method) {
      try {
        const statement = prepare(sql);
        const values = params as Parameters<StatementSync['run']>;
        if (method === 'run') {
          statement.run(...values);
          return [];
        }
        return statement.all(...values) as unknown as unknown[];
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) : 0;
        throw sqliteError(code, (error as Error).message, limitBytes) ?? error;
      }
    },
    async close() {
      statements.clear();
      sqlite.close();
    },
  };
  return createDatabase(driver);
}
