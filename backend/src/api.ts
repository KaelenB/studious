import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from './db/database.js';
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
import type { DocumentExtractors } from './services/extractors.js';

/**
 * Registers every API route on a Fastify-compatible router. It is platform neutral so the same
 * controllers depend only on the FastifyInstance contract.
 */
export function registerApi(
  app: FastifyInstance,
  connection: DatabaseConnection,
  extractors: DocumentExtractors,
) {
  const { db } = connection;
  const service = createFinanceService(createFinanceRepository(db), connection.storage);
  registerErrorHandler(app);
  registerFinanceRoutes(app, createFinanceController(service), service);
  registerStatementRoutes(
    app,
    createStatementController(
      createStatementService(createStatementRepository(db), service, extractors),
    ),
    service,
  );
  registerExpenseRoutes(
    app,
    createExpenseController(createExpenseService(createExpenseRepository(db))),
    service,
  );
  return app;
}
