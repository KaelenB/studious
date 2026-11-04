import type { FastifyRequest } from 'fastify';
import { overviewQuery } from '@studious/api';
import { requestHousehold } from '../middleware/household.js';
import type { OverviewService } from '../services/overview.js';

export function createOverviewController(service: OverviewService) {
  return {
    async show(request: FastifyRequest) {
      const { months, asOf } = overviewQuery.parse(request.query);
      return service.overview(requestHousehold(request).id, months, asOf);
    },
  };
}
