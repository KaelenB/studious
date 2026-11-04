import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { IncomeInput, IncomeUpdate } from '@studious/api';
import type { Database } from '../db/database.js';
import { income } from '../models/schema.js';
import { centsToMoney } from './expenses.js';

export function createIncomeRepository(db: Database) {
  const active = (householdId: string, incomeId: string) =>
    and(eq(income.householdId, householdId), eq(income.id, incomeId), isNull(income.deletedAt));
  return {
    async create(householdId: string, input: IncomeInput) {
      const [row] = await db
        .insert(income)
        .values({ ...input, householdId })
        .returning();
      if (!row) throw new Error('Income insert returned no record');
      return row;
    },
    async update(householdId: string, incomeId: string, input: IncomeUpdate) {
      const [row] = await db
        .update(income)
        .set(input)
        .where(active(householdId, incomeId))
        .returning();
      return row;
    },
    async archive(householdId: string, incomeId: string) {
      const [row] = await db
        .update(income)
        .set({ deletedAt: new Date() })
        .where(active(householdId, incomeId))
        .returning();
      return row;
    },
    list(householdId: string, month: string, limit: number, offset: number) {
      const filter = and(
        eq(income.householdId, householdId),
        isNull(income.deletedAt),
        gte(income.startDate, `${month}-01`),
        lte(income.startDate, `${month}-31`),
      );
      return db.transaction(
        async (tx) => {
          const items = await tx
            .select()
            .from(income)
            .where(filter)
            .orderBy(desc(income.startDate), desc(income.id))
            .limit(limit)
            .offset(offset);
          const totals = await tx
            .select({
              currency: income.currency,
              cents: sql<string>`cast(sum(cast(replace(${income.amount}, '.', '') as integer)) as text)`,
            })
            .from(income)
            .where(filter)
            .groupBy(income.currency)
            .orderBy(income.currency);
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
export type IncomeRepository = ReturnType<typeof createIncomeRepository>;
