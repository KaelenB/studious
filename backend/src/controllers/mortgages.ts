import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  accountParams,
  mortgageQuery,
  mortgageTermsBody,
  prepaymentBody,
  prepaymentParams,
} from '@studious/api';
import type { MortgageService } from '../services/mortgages.js';
import { mortgageView, prepaymentView } from '../views/mortgages.js';

export function createMortgageController(service: MortgageService) {
  return {
    async show(request: FastifyRequest) {
      const { householdId, accountId } = accountParams.parse(request.params);
      const { asOf } = mortgageQuery.parse(request.query);
      return mortgageView(await service.mortgage(householdId, accountId, asOf));
    },
    async saveTerms(request: FastifyRequest) {
      const { householdId, accountId } = accountParams.parse(request.params);
      return mortgageView(
        await service.saveTerms(householdId, accountId, mortgageTermsBody.parse(request.body)),
      );
    },
    async addPrepayment(request: FastifyRequest, reply: FastifyReply) {
      const { householdId, accountId } = accountParams.parse(request.params);
      const prepayment = await service.addPrepayment(
        householdId,
        accountId,
        prepaymentBody.parse(request.body),
      );
      return reply.code(201).send(prepaymentView(prepayment));
    },
    async deletePrepayment(request: FastifyRequest, reply: FastifyReply) {
      const { householdId, accountId, prepaymentId } = prepaymentParams.parse(request.params);
      await service.deletePrepayment(householdId, accountId, prepaymentId);
      return reply.code(204).send();
    },
  };
}
