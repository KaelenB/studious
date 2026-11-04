import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = buildApp(db, { level: config.LOG_LEVEL }, config.CORS_ORIGINS);

pool.on('error', (error) => {
  app.log.error({ err: error }, 'Unexpected PostgreSQL pool error');
});
app.addHook('onClose', async () => {
  await pool.end();
});

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await pool.query('select 1');
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Backend startup failed');
  await app.close();
  process.exitCode = 1;
}
