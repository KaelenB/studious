import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/models/schema.js';
import type { FinanceRepository } from '../src/repositories/finance.js';
import { ApplicationError } from '../src/services/errors.js';
import { createFinanceService } from '../src/services/finance.js';

const account: Account = {
  id: 'account-id',
  householdId: 'household-id',
  memberId: null,
  name: 'Savings',
  type: 'SAVINGS',
  subtype: null,
  currency: 'CAD',
  balanceSource: 'MANUAL',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

function mockRepository() {
  return {
    checkConnection: vi.fn<FinanceRepository['checkConnection']>(),
    createHousehold: vi.fn<FinanceRepository['createHousehold']>(),
    findHousehold: vi.fn<FinanceRepository['findHousehold']>(),
    listMembers: vi.fn<FinanceRepository['listMembers']>(),
    createMember: vi.fn<FinanceRepository['createMember']>(),
    listAccounts: vi.fn<FinanceRepository['listAccounts']>(),
    createAccount: vi.fn<FinanceRepository['createAccount']>(),
    findAccount: vi.fn<FinanceRepository['findAccount']>(),
    updateAccount: vi.fn<FinanceRepository['updateAccount']>(),
    archiveAccount: vi.fn<FinanceRepository['archiveAccount']>(),
    addSnapshot: vi.fn<FinanceRepository['addSnapshot']>(),
    listSnapshots: vi.fn<FinanceRepository['listSnapshots']>(),
  } satisfies FinanceRepository;
}

describe('finance service without HTTP or a database', () => {
  let repository: ReturnType<typeof mockRepository>;
  let service: ReturnType<typeof createFinanceService>;

  beforeEach(() => {
    repository = mockRepository();
    service = createFinanceService(repository, async () => ({ usedBytes: 0, limitBytes: 1 }));
  });

  it('reports a missing household using an application error', async () => {
    await expect(service.requireHousehold('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Household not found',
    });
  });

  it('keeps household scoping on account lookup', async () => {
    repository.findAccount.mockResolvedValue(account);
    expect(await service.requireAccount('household-id', 'account-id')).toBe(account);
    expect(repository.findAccount).toHaveBeenCalledWith('household-id', 'account-id');
  });

  it('rejects unsupported account providers outside the controller too', () => {
    expect(() =>
      service.createAccount('household-id', {
        name: 'Bank',
        type: 'SAVINGS',
        currency: 'CAD',
        balanceSource: 'INTEGRATED',
      }),
    ).toThrow(ApplicationError);
    expect(repository.createAccount).not.toHaveBeenCalled();
  });

  it('does not read or write snapshots for missing or archived accounts', async () => {
    await expect(service.listSnapshots('household-id', 'missing', 100, 0)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.addSnapshot('household-id', 'missing', {
        amount: '1.00',
        asOf: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.listSnapshots).not.toHaveBeenCalled();
    expect(repository.addSnapshot).not.toHaveBeenCalled();
  });

  it('does not append manual balances to a projected account', async () => {
    repository.findAccount.mockResolvedValue({ ...account, balanceSource: 'PROJECTED' });
    await expect(
      service.addSnapshot('household-id', 'account-id', {
        amount: '1.00',
        asOf: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.addSnapshot).not.toHaveBeenCalled();
  });

  it('assigns the manual source and household when recording a balance', async () => {
    repository.findAccount.mockResolvedValue(account);
    const input = { amount: '123456789012.34', asOf: new Date('2026-01-01T00:00:00Z') };
    await service.addSnapshot('household-id', 'account-id', input);
    expect(repository.addSnapshot).toHaveBeenCalledWith({
      ...input,
      householdId: 'household-id',
      accountId: 'account-id',
      source: 'MANUAL',
    });
  });

  it('reports missing accounts on update or archive', async () => {
    await expect(
      service.updateAccount('household-id', 'missing', { name: 'New' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.archiveAccount('household-id', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('allows sub-types only on investment accounts', async () => {
    expect(() =>
      service.createAccount('household-id', {
        name: 'Bank',
        type: 'SAVINGS',
        subtype: 'TFSA',
        currency: 'CAD',
        balanceSource: 'MANUAL',
      }),
    ).toThrow('Only investment accounts can have a sub-type');
    repository.findAccount.mockResolvedValue(account);
    await expect(
      service.updateAccount('household-id', 'account-id', { subtype: 'TFSA' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.updateAccount).not.toHaveBeenCalled();

    const investment = { ...account, type: 'INVESTMENT' as const, subtype: 'DCPP' as const };
    repository.findAccount.mockResolvedValue(investment);
    repository.updateAccount.mockResolvedValue(investment);
    await service.updateAccount('household-id', 'account-id', { subtype: 'DCPP' });
    expect(repository.updateAccount).toHaveBeenCalledWith('household-id', 'account-id', {
      subtype: 'DCPP',
    });
  });
});
