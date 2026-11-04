import type { FastifyInstance } from 'fastify';
import { budgetFileLimit } from '@studious/api';
import type { createBudgetController } from '../controllers/budget.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerBudgetRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createBudgetController>,
  finance: FinanceService,
) {
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(finance));
      scoped.addHook('onSend', async (_request, reply, payload) => {
        reply.header('Cache-Control', 'no-store');
        return payload;
      });
      scoped.addContentTypeParser(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        { parseAs: 'buffer', bodyLimit: budgetFileLimit },
        (_request, body, done) => done(null, body),
      );
      scoped.post('/budget-imports/preview', { bodyLimit: budgetFileLimit }, controller.preview);
      scoped.post('/budget-imports', { bodyLimit: budgetFileLimit }, controller.import);
    },
    { prefix: '/households/:householdId' },
  );
}
