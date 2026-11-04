import type { FastifyReply, FastifyRequest } from 'fastify';
import { requestHousehold } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';
import {
  accountBody,
  accountParams,
  accountUpdateBody,
  historyQuery,
  householdBody,
  memberBody,
  snapshotBody,
} from '../validation.js';
import { accountView, householdView, memberView, snapshotView } from '../views/finance.js';

export function createFinanceController(service: FinanceService) {
  return {
    async health(request: FastifyRequest, reply: FastifyReply) {
      try {
        await service.checkConnection();
        return { status: 'ok', database: 'ok' };
      } catch (error) {
        request.log.error({ err: error }, 'Database health check failed');
        return reply.code(503).send({ status: 'unavailable', database: 'unavailable' });
      }
    },
    async createHousehold(request: FastifyRequest, reply: FastifyReply) {
      const household = await service.createHousehold(householdBody.parse(request.body));
      return reply.code(201).send(householdView(household));
    },
    async getHousehold(request: FastifyRequest) {
      return householdView(requestHousehold(request));
    },
    async listMembers(request: FastifyRequest) {
      const members = await service.listMembers(requestHousehold(request).id);
      return members.map(memberView);
    },
    async createMember(request: FastifyRequest, reply: FastifyReply) {
      const member = await service.createMember(
        requestHousehold(request).id,
        memberBody.parse(request.body),
      );
      return reply.code(201).send(memberView(member));
    },
    async listAccounts(request: FastifyRequest) {
      const accounts = await service.listAccounts(requestHousehold(request).id);
      return accounts.map(accountView);
    },
    async createAccount(request: FastifyRequest, reply: FastifyReply) {
      const account = await service.createAccount(
        requestHousehold(request).id,
        accountBody.parse(request.body),
      );
      return reply.code(201).send(accountView(account));
    },
    async getAccount(request: FastifyRequest) {
      const { accountId } = accountParams.parse(request.params);
      return accountView(await service.requireAccount(requestHousehold(request).id, accountId));
    },
    async updateAccount(request: FastifyRequest) {
      const { accountId } = accountParams.parse(request.params);
      const account = await service.updateAccount(
        requestHousehold(request).id,
        accountId,
        accountUpdateBody.parse(request.body),
      );
      return accountView(account);
    },
    async archiveAccount(request: FastifyRequest, reply: FastifyReply) {
      const { accountId } = accountParams.parse(request.params);
      await service.archiveAccount(requestHousehold(request).id, accountId);
      return reply.code(204).send();
    },
    async listSnapshots(request: FastifyRequest) {
      const { accountId } = accountParams.parse(request.params);
      const { limit, offset } = historyQuery.parse(request.query);
      const snapshots = await service.listSnapshots(
        requestHousehold(request).id,
        accountId,
        limit,
        offset,
      );
      return snapshots.map(snapshotView);
    },
    async addSnapshot(request: FastifyRequest, reply: FastifyReply) {
      const { accountId } = accountParams.parse(request.params);
      const snapshot = await service.addSnapshot(
        requestHousehold(request).id,
        accountId,
        snapshotBody.parse(request.body),
      );
      return reply.code(201).send(snapshotView(snapshot));
    },
  };
}

export type FinanceController = ReturnType<typeof createFinanceController>;
