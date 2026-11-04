import type { IncomeInput, IncomeUpdate } from '@studious/api';
import type { IncomeRepository } from '../repositories/income.js';
import { ApplicationError } from './errors.js';

export function createIncomeService(repository: IncomeRepository) {
  return {
    create: (householdId: string, input: IncomeInput) => repository.create(householdId, input),
    list: (householdId: string, month: string, limit: number, offset: number) =>
      repository.list(householdId, month, limit, offset),
    async update(householdId: string, incomeId: string, input: IncomeUpdate) {
      const row = await repository.update(householdId, incomeId, input);
      if (!row) throw new ApplicationError('NOT_FOUND', 'Income not found');
      return row;
    },
    async archive(householdId: string, incomeId: string) {
      if (!(await repository.archive(householdId, incomeId)))
        throw new ApplicationError('NOT_FOUND', 'Income not found');
    },
  };
}
export type IncomeService = ReturnType<typeof createIncomeService>;
