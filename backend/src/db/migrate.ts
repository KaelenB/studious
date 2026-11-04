import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';

const { db, pool } = createDatabase(loadConfig().DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  console.info('Database migrations completed.');
} finally {
  await pool.end();
}
