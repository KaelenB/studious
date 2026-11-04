import type { FastifyInstance } from 'fastify';
import type { createExpenseController } from '../controllers/expenses.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerExpenseRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createExpenseController>,
  financeService: FinanceService,
) {
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(financeService));
      scoped.get('/expense-categories', controller.listCategories);
      scoped.post('/expense-categories', controller.createCategory);
      scoped.get('/expenses', controller.listExpenses);
      scoped.post('/expenses', controller.createExpense);
      scoped.patch('/expenses/:expenseId', controller.updateExpense);
      scoped.delete('/expenses/:expenseId', controller.archiveExpense);
    },
    { prefix: '/households/:householdId' },
  );
}
