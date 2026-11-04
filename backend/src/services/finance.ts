import type {
  AccountUpdate,
  NewAccount,
  NewBalanceSnapshot,
  NewHousehold,
  NewMember,
} from '../models/schema.js';
import type { FinanceRepository } from '../repositories/finance.js';
import { ApplicationError } from './errors.js';

export function createFinanceService(repository: FinanceRepository) {
  async function requireHousehold(householdId: string) {
    const household = await repository.findHousehold(householdId);
    if (!household) throw new ApplicationError('NOT_FOUND', 'Household not found');
    return household;
  }

  async function requireAccount(householdId: string, accountId: string) {
    const account = await repository.findAccount(householdId, accountId);
    if (!account) throw new ApplicationError('NOT_FOUND', 'Account not found');
    return account;
  }

  return {
    requireHousehold,
    requireAccount,
    checkConnection: () => repository.checkConnection(),
    createHousehold: (input: NewHousehold) => repository.createHousehold(input),
    listMembers: (householdId: string) => repository.listMembers(householdId),
    createMember: (householdId: string, input: NewMember) =>
      repository.createMember({ ...input, householdId }),
    listAccounts: (householdId: string) => repository.listAccounts(householdId),
    createAccount(householdId: string, input: NewAccount) {
      if (input.balanceSource !== 'MANUAL') {
        throw new ApplicationError('CONFLICT', 'Only manual accounts are supported in this phase');
      }
      return repository.createAccount({ ...input, householdId });
    },
    async updateAccount(householdId: string, accountId: string, input: AccountUpdate) {
      const account = await repository.updateAccount(householdId, accountId, input);
      if (!account) throw new ApplicationError('NOT_FOUND', 'Account not found');
      return account;
    },
    async archiveAccount(householdId: string, accountId: string) {
      const account = await repository.archiveAccount(householdId, accountId);
      if (!account) throw new ApplicationError('NOT_FOUND', 'Account not found');
    },
    async listSnapshots(householdId: string, accountId: string, limit: number, offset: number) {
      await requireAccount(householdId, accountId);
      return repository.listSnapshots(householdId, accountId, limit, offset);
    },
    async addSnapshot(householdId: string, accountId: string, input: NewBalanceSnapshot) {
      const account = await requireAccount(householdId, accountId);
      if (account.balanceSource !== 'MANUAL') {
        throw new ApplicationError('CONFLICT', 'Only manual balances are supported in this phase');
      }
      return repository.addSnapshot({ ...input, householdId, accountId, source: 'MANUAL' });
    },
  };
}

export type FinanceService = ReturnType<typeof createFinanceService>;
