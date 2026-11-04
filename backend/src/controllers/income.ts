import type { FastifyReply, FastifyRequest } from 'fastify';
import { expenseQuery, incomeBody, incomeParams, incomeUpdateBody } from '@studious/api';
import { requestHousehold } from '../middleware/household.js';
import type { IncomeService } from '../services/income.js';
import { incomeView } from '../views/income.js';

export function createIncomeController(service: IncomeService) {
  return {
    async list(request: FastifyRequest) {
      const { month, limit, offset } = expenseQuery.parse(request.query);
      const page = await service.list(requestHousehold(request).id, month, limit, offset);
      return { items: page.items.map(incomeView), totals: page.totals };
    },
    async create(request: FastifyRequest, reply: FastifyReply) {
      return reply
        .code(201)
        .send(
          incomeView(
            await service.create(requestHousehold(request).id, incomeBody.parse(request.body)),
          ),
        );
    },
    async update(request: FastifyRequest) {
      const { incomeId } = incomeParams.parse(request.params);
      return incomeView(
        await service.update(
          requestHousehold(request).id,
          incomeId,
          incomeUpdateBody.parse(request.body),
        ),
      );
    },
    async archive(request: FastifyRequest, reply: FastifyReply) {
      const { incomeId } = incomeParams.parse(request.params);
      await service.archive(requestHousehold(request).id, incomeId);
      return reply.code(204).send();
    },
  };
}
