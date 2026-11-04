import type { Expense, ExpenseCategory } from '../models/schema.js';
import type {
  Expense as ExpenseResponse,
  ExpenseCategory as CategoryResponse,
} from '@studious/api';

export function expenseCategoryView(model: ExpenseCategory): CategoryResponse {
  return {
    id: model.id,
    householdId: model.householdId,
    name: model.name,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

export function expenseView(model: Expense): ExpenseResponse {
  return {
    id: model.id,
    householdId: model.householdId,
    name: model.name,
    memberId: model.memberId,
    categoryId: model.categoryId,
    amount: model.amount,
    currency: model.currency,
    startDate: model.startDate,
    deletedAt: model.deletedAt?.toISOString() ?? null,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}
