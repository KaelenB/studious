import type { FastifyInstance } from 'fastify';
import type { FinanceController } from '../controllers/finance.js';
import { householdScope } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';

export function registerFinanceRoutes(
  app: FastifyInstance,
  controller: FinanceController,
  service: FinanceService,
) {
  app.get('/health', controller.health);
  app.post('/households', controller.createHousehold);
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(service));
      scoped.get('/', controller.getHousehold);
      scoped.get('/members', controller.listMembers);
      scoped.post('/members', controller.createMember);
      scoped.get('/accounts', controller.listAccounts);
      scoped.post('/accounts', controller.createAccount);
      scoped.get('/accounts/:accountId', controller.getAccount);
      scoped.patch('/accounts/:accountId', controller.updateAccount);
      scoped.delete('/accounts/:accountId', controller.archiveAccount);
      scoped.get('/accounts/:accountId/balances', controller.listSnapshots);
      scoped.post('/accounts/:accountId/balances', controller.addSnapshot);
    },
    { prefix: '/households/:householdId' },
  );
}
