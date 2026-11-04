import { and, asc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { balanceSnapshots, expenses, income } from '../models/schema.js';
import { centsToMoney } from './expenses.js';

export function createOverviewRepository(db: Database) {
  return {
    async incomeTotals(householdId: string, from: string, through: string) {
      const month = sql<string>`substr(${income.startDate}, 1, 7)`;
      const rows = await db
        .select({
          month,
          currency: income.currency,
          memberId: income.memberId,
          cents: sql<string>`cast(sum(cast(replace(${income.amount}, '.', '') as integer)) as text)`,
        })
        .from(income)
        .where(
          and(
            eq(income.householdId, householdId),
            isNull(income.deletedAt),
            gte(income.startDate, from),
            lte(income.startDate, through),
          ),
        )
        .groupBy(month, income.currency, income.memberId)
        .orderBy(month, income.currency);
      return rows.map(({ cents, ...row }) => ({ ...row, amount: centsToMoney(BigInt(cents)) }));
    },
    /** Latest snapshot per account strictly before `before`. */
    latestBalancesBefore(householdId: string, before: Date) {
      const ranked = db
        .select({
          accountId: balanceSnapshots.accountId,
          amount: balanceSnapshots.amount,
          rank: sql<number>`row_number() over (partition by ${balanceSnapshots.accountId} order by ${balanceSnapshots.asOf} desc, ${balanceSnapshots.id} desc)`.as(
            'rank',
          ),
        })
        .from(balanceSnapshots)
        .where(
          and(eq(balanceSnapshots.householdId, householdId), lt(balanceSnapshots.asOf, before)),
        )
        .as('ranked');
      return db
        .select({ accountId: ranked.accountId, amount: ranked.amount })
        .from(ranked)
        .where(eq(ranked.rank, 1));
    },
    snapshotsBetween(householdId: string, from: Date, to: Date) {
      return db
        .select({
          accountId: balanceSnapshots.accountId,
          amount: balanceSnapshots.amount,
          asOf: balanceSnapshots.asOf,
        })
        .from(balanceSnapshots)
        .where(
          and(
            eq(balanceSnapshots.householdId, householdId),
            gte(balanceSnapshots.asOf, from),
            lt(balanceSnapshots.asOf, to),
          ),
        )
        .orderBy(asc(balanceSnapshots.asOf), asc(balanceSnapshots.id));
    },
    async expenseTotals(householdId: string, from: string, through: string) {
      const month = sql<string>`substr(${expenses.startDate}, 1, 7)`;
      const rows = await db
        .select({
          month,
          currency: expenses.currency,
          categoryId: expenses.categoryId,
          memberId: expenses.memberId,
          // Amounts are canonical "123.45" strings, so removing the point yields exact cents.
          cents: sql<string>`cast(sum(cast(replace(${expenses.amount}, '.', '') as integer)) as text)`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.householdId, householdId),
            isNull(expenses.deletedAt),
            gte(expenses.startDate, from),
            lte(expenses.startDate, through),
          ),
        )
        .groupBy(month, expenses.currency, expenses.categoryId, expenses.memberId)
        .orderBy(month, expenses.currency);
      return rows.map(({ cents, ...row }) => ({ ...row, amount: centsToMoney(BigInt(cents)) }));
    },
  };
}

export type OverviewRepository = ReturnType<typeof createOverviewRepository>;
