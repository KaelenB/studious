import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../models/schema.js';

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  return { db: drizzle(pool, { schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
