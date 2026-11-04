import type { FastifyInstance } from 'fastify';
import type { createIncomeController } from '../controllers/income.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerIncomeRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createIncomeController>,
  finance: FinanceService,
) {
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(finance));
      scoped.get('/income', controller.list);
      scoped.post('/income', controller.create);
      scoped.patch('/income/:incomeId', controller.update);
      scoped.delete('/income/:incomeId', controller.archive);
    },
    { prefix: '/households/:householdId' },
  );
}
