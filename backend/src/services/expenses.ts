import type { ExpenseInput, ExpenseUpdate } from '@studious/api';
import type { ExpenseRepository } from '../repositories/expenses.js';
import { ApplicationError } from './errors.js';

export function createExpenseService(repository: ExpenseRepository) {
  return {
    listCategories: (householdId: string) => repository.listCategories(householdId),
    createCategory: (householdId: string, name: string) =>
      repository.createCategory({ householdId, name }),
    createExpense: (householdId: string, input: ExpenseInput) =>
      repository.createExpense({ ...input, householdId }),
    listExpenses: (householdId: string, month: string, limit: number, offset: number) =>
      repository.listExpenses(householdId, month, limit, offset),
    async updateExpense(householdId: string, expenseId: string, input: ExpenseUpdate) {
      const expense = await repository.updateExpense(householdId, expenseId, input);
      if (!expense) throw new ApplicationError('NOT_FOUND', 'Expense not found');
      return expense;
    },
    async archiveExpense(householdId: string, expenseId: string) {
      const expense = await repository.archiveExpense(householdId, expenseId);
      if (!expense) throw new ApplicationError('NOT_FOUND', 'Expense not found');
    },
  };
}

export type ExpenseService = ReturnType<typeof createExpenseService>;
