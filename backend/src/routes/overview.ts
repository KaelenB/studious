import type { FastifyInstance } from 'fastify';
import type { createOverviewController } from '../controllers/overview.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerOverviewRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createOverviewController>,
  financeService: FinanceService,
) {
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(financeService));
      scoped.get('/overview', controller.show);
    },
    { prefix: '/households/:householdId' },
  );
}
