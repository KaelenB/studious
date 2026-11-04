import type { FastifyReply, FastifyRequest } from 'fastify';
import { budgetConfirmQuery, budgetUploadQuery } from '@studious/api';
import { requestHousehold } from '../middleware/household.js';
import type { BudgetService } from '../services/budget.js';
import { StatementError } from '../services/extractors.js';

export function createBudgetController(service: BudgetService) {
  const upload = (request: FastifyRequest) => {
    if (!(request.body instanceof Uint8Array))
      throw new StatementError('Send an XLSX workbook with the Excel Content-Type.');
    return request.body;
  };
  return {
    async preview(request: FastifyRequest) {
      const { filename, currency } = budgetUploadQuery.parse(request.query);
      return service.preview(requestHousehold(request).id, filename, currency, upload(request));
    },
    async import(request: FastifyRequest, reply: FastifyReply) {
      const { filename, currency, sha256, members } = budgetConfirmQuery.parse(request.query);
      return reply
        .code(201)
        .send(
          await service.import(
            requestHousehold(request).id,
            filename,
            currency,
            upload(request),
            sha256,
            members,
          ),
        );
    },
  };
}
