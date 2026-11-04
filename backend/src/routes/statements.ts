import type { FastifyInstance } from 'fastify';
import { statementFileLimit } from '@studious/api';
import type { createStatementController } from '../controllers/statements.js';
import type { FinanceService } from '../services/finance.js';
import { householdScope } from '../middleware/household.js';

export function registerStatementRoutes(
  app: FastifyInstance,
  controller: ReturnType<typeof createStatementController>,
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
        ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        { parseAs: 'buffer', bodyLimit: statementFileLimit },
        (_request, body, done) => done(null, body),
      );
      scoped.post('/statements/preview', { bodyLimit: statementFileLimit }, controller.preview);
      scoped.post('/statements', { bodyLimit: statementFileLimit }, controller.import);
      scoped.get('/statements', controller.list);
      scoped.get('/statements/:statementId/pdf', controller.download);
      scoped.get('/statements/:statementId/file', controller.download);
      scoped.post('/statements/:statementId/investments', controller.extractInvestments);
    },
    { prefix: '/households/:householdId/accounts/:accountId' },
  );
}
