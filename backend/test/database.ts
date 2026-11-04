import { openNodeDatabase } from '../src/db/node.js';

/** A migrated, isolated in-memory SQLite database. Migrating twice proves idempotency. */
export async function testDatabase(limitBytes?: number) {
  const database = openNodeDatabase(':memory:', limitBytes);
  await database.migrate();
  await database.migrate();
  return database;
}
