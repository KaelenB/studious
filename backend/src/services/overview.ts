import type { Overview } from '@studious/api';
import type { OverviewRepository } from '../repositories/overview.js';
import type { FinanceService } from './finance.js';

const today = () => new Date().toISOString().slice(0, 10);
const monthLabel = (date: Date) => date.toISOString().slice(0, 7);
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1));

export function createOverviewService(repository: OverviewRepository, finance: FinanceService) {
  return {
    /**
     * Month-end balances for every active account plus monthly expense totals over the
     * `months` calendar months (UTC) ending with the month that contains `asOf`.
     */
    async overview(householdId: string, months: number, asOf = today()): Promise<Overview> {
      const [year, month] = asOf.split('-').map(Number) as [number, number];
      // monthStart(...) normalises overflow, so index i is the start of month i of the window.
      const starts = Array.from({ length: months + 1 }, (_, index) =>
        monthStart(year, month - months + index),
      );
      const windowStart = starts[0]!;
      const windowEnd = new Date(`${asOf}T00:00:00.000Z`);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
      const [accounts, baseline, snapshots, expenses, income] = await Promise.all([
        finance.listAccounts(householdId),
        repository.latestBalancesBefore(householdId, windowStart),
        repository.snapshotsBetween(householdId, windowStart, windowEnd),
        repository.expenseTotals(householdId, windowStart.toISOString().slice(0, 10), asOf),
        repository.incomeTotals(householdId, windowStart.toISOString().slice(0, 10), asOf),
      ]);

      const current = new Map(baseline.map((row) => [row.accountId, row.amount]));
      const series = new Map(accounts.map((account) => [account.id, [] as (string | null)[]]));
      let next = 0;
      for (const monthEnd of starts.slice(1)) {
        const end = monthEnd < windowEnd ? monthEnd : windowEnd;
        while (next < snapshots.length && snapshots[next]!.asOf < end) {
          const snapshot = snapshots[next++]!;
          current.set(snapshot.accountId, snapshot.amount);
        }
        for (const [accountId, balances] of series) balances.push(current.get(accountId) ?? null);
      }

      return {
        months: starts.slice(0, months).map(monthLabel),
        accounts: [...series].map(([accountId, balances]) => ({ accountId, balances })),
        expenses,
        income,
      };
    },
  };
}

export type OverviewService = ReturnType<typeof createOverviewService>;
