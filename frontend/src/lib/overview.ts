import type { Account, ExpenseCategory, Member, Overview } from '@studious/api';
import { accountKind } from './api';
import { cents } from './money';

export const chartColors = ['#1d6251', '#2b6cb0', '#b7791f', '#8556a5', '#c0392b', '#348c91'];
export const chartColor = (index: number) => chartColors[index % chartColors.length]!;
export const isDebt = (account: Account) => ['CREDIT', 'LOAN', 'MORTGAGE'].includes(account.type);
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

export function householdTrends(
  overview: Overview,
  accounts: Account[],
  members: Member[],
  categories: ExpenseCategory[],
  currency: string,
) {
  const selected = accounts.filter((account) => account.currency === currency);
  const balances = new Map(overview.accounts.map((entry) => [entry.accountId, entry.balances]));
  const points = overview.months.map((month, index) => {
    let assets = 0n;
    let debts = 0n;
    let investments = 0n;
    let investmentCount = 0;
    const observed: string[] = [];
    for (const account of selected) {
      const balance = balances.get(account.id)?.[index];
      if (balance == null) continue;
      observed.push(account.id);
      const value = cents(balance);
      if (isDebt(account)) debts += value;
      else assets += value;
      if (account.type === 'INVESTMENT') {
        investments += value;
        investmentCount++;
      }
    }
    return {
      month,
      assets: observed.length ? assets : null,
      debts: observed.length ? debts : null,
      net: observed.length ? assets - debts : null,
      investments: investmentCount ? investments : null,
      observed: observed.sort().join(','),
      missing: selected.length - observed.length,
    };
  });

  const last = overview.months.length - 1;
  const allocation = new Map<string, bigint>();
  const owners = new Map<string, { label: string; value: bigint }>();
  for (const account of selected) {
    const balance = balances.get(account.id)?.[last];
    if (balance == null) continue;
    const value = cents(balance);
    if (!isDebt(account) && value > 0n) {
      const label = accountKind(account);
      allocation.set(label, (allocation.get(label) ?? 0n) + value);
    }
    const owner = account.memberId ?? 'shared';
    const entry = owners.get(owner) ?? {
      label: members.find((member) => member.id === account.memberId)?.name ?? 'Shared household',
      value: 0n,
    };
    entry.value += isDebt(account) ? -value : value;
    owners.set(owner, entry);
  }

  const spending = new Map<string, { label: string; values: bigint[] }>();
  for (const expense of overview.expenses.filter((item) => item.currency === currency)) {
    const key = expense.categoryId ?? 'uncategorized';
    const entry = spending.get(key) ?? {
      label:
        categories.find((category) => category.id === expense.categoryId)?.name ?? 'Uncategorized',
      values: overview.months.map(() => 0n),
    };
    const index = overview.months.indexOf(expense.month);
    if (index >= 0) entry.values[index] = entry.values[index]! + cents(expense.amount);
    spending.set(key, entry);
  }
  const cashflow = overview.months.map((month) => {
    const receipts = overview.income
      .filter((item) => item.currency === currency && item.month === month)
      .reduce((sum, item) => sum + cents(item.amount), 0n);
    const outgoings = overview.expenses
      .filter((item) => item.currency === currency && item.month === month)
      .reduce((sum, item) => sum + cents(item.amount), 0n);
    return { month, income: receipts, expenses: outgoings, net: receipts - outgoings };
  });

  return {
    points,
    cashflow,
    allocation: [...allocation].map(([key, value]) => ({ key, label: key, value })),
    owners: [...owners]
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    spending: [...spending].map(([key, entry]) => ({ key, ...entry })),
  };
}

/** Missing observations or a changed account set do not provide a comparable growth figure. */
export function netChange(
  points: ReturnType<typeof householdTrends>['points'],
  from: number,
  to = points.length - 1,
) {
  const previous = points[from];
  const current = points[to];
  if (
    !previous ||
    !current ||
    previous.net === null ||
    current.net === null ||
    previous.observed !== current.observed
  )
    return null;
  const amount = current.net - previous.net;
  return {
    amount,
    percent: previous.net > 0n ? (Number(amount) / Number(previous.net)) * 100 : null,
  };
}
