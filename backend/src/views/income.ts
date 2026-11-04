import type { Income } from '../models/schema.js';
import type { Income as IncomeResponse } from '@studious/api';

export function incomeView(row: Income): IncomeResponse {
  return {
    id: row.id,
    householdId: row.householdId,
    memberId: row.memberId,
    name: row.name,
    amount: row.amount,
    currency: row.currency,
    startDate: row.startDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
