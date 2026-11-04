import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { expenseCategories, expenses } from '../models/schema.js';
import type { ExpenseUpdate } from '@studious/api';

function nextMonth(month: string) {
  const [year, value] = month.split('-').map(Number) as [number, number];
  return value === 12
    ? `${String(year + 1).padStart(4, '0')}-01-01`
    : `${String(year).padStart(4, '0')}-${String(value + 1).padStart(2, '0')}-01`;
}

/** Formats an integer number of cents as the API's two-place decimal string. */
export function centsToMoney(cents: bigint) {
  const sign = cents < 0n ? '-' : '';
  const absolute = (cents < 0n ? -cents : cents).toString().padStart(3, '0');
  return `${sign}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

export function createExpenseRepository(db: Database) {
  const activeExpense = (householdId: string, expenseId: string) =>
    and(
      eq(expenses.householdId, householdId),
      eq(expenses.id, expenseId),
      isNull(expenses.deletedAt),
    );
  const inMonth = (householdId: string, month: string) =>
    and(
      eq(expenses.householdId, householdId),
      isNull(expenses.deletedAt),
      gte(expenses.startDate, `${month}-01`),
      lt(expenses.startDate, nextMonth(month)),
    );

  return {
    listCategories(householdId: string) {
      return db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.householdId, householdId))
        .orderBy(expenseCategories.name, expenseCategories.id);
    },
    async createCategory(input: typeof expenseCategories.$inferInsert) {
      const [category] = await db.insert(expenseCategories).values(input).returning();
      if (!category) throw new Error('Expense category insert returned no record');
      return category;
    },
    async createExpense(input: typeof expenses.$inferInsert) {
      const [expense] = await db.insert(expenses).values(input).returning();
      if (!expense) throw new Error('Expense insert returned no record');
      return expense;
    },
    async updateExpense(householdId: string, expenseId: string, input: ExpenseUpdate) {
      const [expense] = await db
        .update(expenses)
        .set(input)
        .where(activeExpense(householdId, expenseId))
        .returning();
      return expense;
    },
    async archiveExpense(householdId: string, expenseId: string) {
      const [expense] = await db
        .update(expenses)
        .set({ deletedAt: new Date() })
        .where(activeExpense(householdId, expenseId))
        .returning();
      return expense;
    },
    async listExpenses(householdId: string, month: string, limit: number, offset: number) {
      return db.transaction(
        async (tx) => {
          const items = await tx
            .select()
            .from(expenses)
            .where(inMonth(householdId, month))
            .orderBy(desc(expenses.startDate), desc(expenses.id))
            .limit(limit)
            .offset(offset);
          const totals = await tx
            .select({
              currency: expenses.currency,
              // Amounts are canonical "123.45" strings, so removing the point yields exact cents.
              cents: sql<string>`cast(sum(cast(replace(${expenses.amount}, '.', '') as integer)) as text)`,
            })
            .from(expenses)
            .where(inMonth(householdId, month))
            .groupBy(expenses.currency)
            .orderBy(expenses.currency);
          return {
            items,
            totals: totals.map(({ currency, cents }) => ({
              currency,
              amount: centsToMoney(BigInt(cents)),
            })),
          };
        },
        { behavior: 'deferred' },
      );
    },
  };
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
