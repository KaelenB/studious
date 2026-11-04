import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openNodeDatabase } from './db/node.js';

const config = loadConfig();
const database = openNodeDatabase(config.DATABASE_PATH, config.DATABASE_MAX_BYTES);
const app = buildApp(database, { level: config.LOG_LEVEL }, config.CORS_ORIGINS);

app.addHook('onClose', async () => {
  await database.close();
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
  await database.migrate();
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Backend startup failed');
  await app.close();
  process.exitCode = 1;
}
