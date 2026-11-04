import type { FastifyInstance } from 'fastify';
import type { createMortgageController } from '../controllers/mortgages.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerMortgageRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createMortgageController>,
  financeService: FinanceService,
) {
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(financeService));
      scoped.get('/mortgage', controller.show);
      scoped.put('/mortgage', controller.saveTerms);
      scoped.post('/mortgage/prepayments', controller.addPrepayment);
      scoped.delete('/mortgage/prepayments/:prepaymentId', controller.deletePrepayment);
    },
    { prefix: '/households/:householdId/accounts/:accountId' },
  );
}
