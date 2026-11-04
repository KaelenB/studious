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
import { createMortgageRepository } from './repositories/mortgages.js';
import { createMortgageService } from './services/mortgages.js';
import { createMortgageController } from './controllers/mortgages.js';
import { registerMortgageRoutes } from './routes/mortgages.js';
import { createOverviewRepository } from './repositories/overview.js';
import { createOverviewService } from './services/overview.js';
import { createOverviewController } from './controllers/overview.js';
import { registerOverviewRoutes } from './routes/overview.js';
import type { DocumentExtractors } from './services/extractors.js';
import { createIncomeRepository } from './repositories/income.js';
import { createIncomeService } from './services/income.js';
import { createIncomeController } from './controllers/income.js';
import { registerIncomeRoutes } from './routes/income.js';
import { createBudgetRepository } from './repositories/budget.js';
import { createBudgetService } from './services/budget.js';
import { createBudgetController } from './controllers/budget.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerMarketRoutes } from './routes/market.js';

/**
 * Registers every API route on a Fastify-compatible router. It is platform neutral so the same
 * controllers depend only on the FastifyInstance contract.
 */
export function registerApi(
  app: FastifyInstance,
  connection: DatabaseConnection,
  extractors: DocumentExtractors,
  marketFetch: typeof fetch = fetch,
) {
  const { db } = connection;
  const service = createFinanceService(createFinanceRepository(db), connection.storage);
  registerErrorHandler(app);
  registerBackupRoutes(app, connection);
  registerMarketRoutes(app, db, service, marketFetch);
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
  registerMortgageRoutes(
    app,
    createMortgageController(createMortgageService(createMortgageRepository(db), service)),
    service,
  );
  registerOverviewRoutes(
    app,
    createOverviewController(createOverviewService(createOverviewRepository(db), service)),
    service,
  );
  registerIncomeRoutes(
    app,
    createIncomeController(createIncomeService(createIncomeRepository(db))),
    service,
  );
  registerBudgetRoutes(
    app,
    createBudgetController(createBudgetService(createBudgetRepository(db), extractors)),
    service,
  );
  return app;
}
