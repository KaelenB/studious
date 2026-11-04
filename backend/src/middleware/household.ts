import type { FastifyRequest } from 'fastify';
import type { Household } from '../models/schema.js';
import type { FinanceService } from '../services/finance.js';
import { householdParams } from '../validation.js';

declare module 'fastify' {
  interface FastifyRequest {
    household: Household | null;
  }
}

export function householdScope(service: FinanceService) {
  return async (request: FastifyRequest) => {
    const { householdId } = householdParams.parse(request.params);
    request.household = await service.requireHousehold(householdId);
  };
}

export function requestHousehold(request: FastifyRequest) {
  if (!request.household) throw new Error('Household middleware was not initialized');
  return request.household;
}
