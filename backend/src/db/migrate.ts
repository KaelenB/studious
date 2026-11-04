import { loadConfig } from '../config.js';
import { openNodeDatabase } from './node.js';

const config = loadConfig();
const database = openNodeDatabase(config.DATABASE_PATH, config.DATABASE_MAX_BYTES);

try {
  await database.migrate();
  console.info('Database migrations completed.');
} finally {
  await database.close();
}
