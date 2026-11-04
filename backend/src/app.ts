import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Database } from './db/client.js';
import { createFinanceController } from './controllers/finance.js';
import { registerErrorHandler } from './middleware/errors.js';
import { createFinanceRepository } from './repositories/finance.js';
import { registerFinanceRoutes } from './routes/finance.js';
import { createFinanceService } from './services/finance.js';
import { createExpenseRepository } from './repositories/expenses.js';
import { createExpenseService } from './services/expenses.js';
import { createExpenseController } from './controllers/expenses.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { createStatementRepository } from './repositories/statements.js';
import { createStatementService } from './services/statements.js';
import { createStatementController } from './controllers/statements.js';
import { registerStatementRoutes } from './routes/statements.js';

export function buildApp(
  db: Database,
  logger: boolean | { level: string } = true,
  corsOrigins: string[] = [],
) {
  const app = Fastify({ logger, bodyLimit: 65536 });
  const repository = createFinanceRepository(db);
  const service = createFinanceService(repository);
  const controller = createFinanceController(service);

  registerErrorHandler(app);
  if (corsOrigins.length) {
    // Allows a separately hosted static frontend (e.g. GitHub Pages) to call this API.
    void app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    });
  }
  registerFinanceRoutes(app, controller, service);
  registerStatementRoutes(
    app,
    createStatementController(createStatementService(createStatementRepository(db), service)),
    service,
  );
  registerExpenseRoutes(
    app,
    createExpenseController(createExpenseService(createExpenseRepository(db))),
    service,
  );
  return app;
}
