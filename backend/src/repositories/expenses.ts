import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expenseCategories, expenses } from '../models/schema.js';
import type { ExpenseUpdate } from '@studious/api';

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
      lt(expenses.startDate, sql`(${`${month}-01`}::date + interval '1 month')::date`),
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
              amount: sql<string>`sum(${expenses.amount})::text`,
            })
            .from(expenses)
            .where(inMonth(householdId, month))
            .groupBy(expenses.currency)
            .orderBy(expenses.currency);
          return { items, totals };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  };
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
