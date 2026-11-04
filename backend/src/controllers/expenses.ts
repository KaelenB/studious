import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  expenseBody,
  expenseCategoryBody,
  expenseParams,
  expenseQuery,
  expenseUpdateBody,
} from '@studious/api';
import { requestHousehold } from '../middleware/household.js';
import type { ExpenseService } from '../services/expenses.js';
import { expenseCategoryView, expenseView } from '../views/expenses.js';

export function createExpenseController(service: ExpenseService) {
  return {
    async listCategories(request: FastifyRequest) {
      return (await service.listCategories(requestHousehold(request).id)).map(expenseCategoryView);
    },
    async createCategory(request: FastifyRequest, reply: FastifyReply) {
      const { name } = expenseCategoryBody.parse(request.body);
      return reply
        .code(201)
        .send(
          expenseCategoryView(await service.createCategory(requestHousehold(request).id, name)),
        );
    },
    async listExpenses(request: FastifyRequest) {
      const { month, limit, offset } = expenseQuery.parse(request.query);
      const page = await service.listExpenses(requestHousehold(request).id, month, limit, offset);
      return { items: page.items.map(expenseView), totals: page.totals };
    },
    async createExpense(request: FastifyRequest, reply: FastifyReply) {
      return reply
        .code(201)
        .send(
          expenseView(
            await service.createExpense(
              requestHousehold(request).id,
              expenseBody.parse(request.body),
            ),
          ),
        );
    },
    async updateExpense(request: FastifyRequest) {
      const { expenseId } = expenseParams.parse(request.params);
      return expenseView(
        await service.updateExpense(
          requestHousehold(request).id,
          expenseId,
          expenseUpdateBody.parse(request.body),
        ),
      );
    },
    async archiveExpense(request: FastifyRequest, reply: FastifyReply) {
      const { expenseId } = expenseParams.parse(request.params);
      await service.archiveExpense(requestHousehold(request).id, expenseId);
      return reply.code(204).send();
    },
  };
}
