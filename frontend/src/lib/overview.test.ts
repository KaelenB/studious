import { describe, expect, it } from 'vitest';
import type { Account, Overview } from '@studious/api';
import { householdTrends, netChange } from './overview';

const account = (id: string, type: Account['type'], currency = 'CAD'): Account => ({
  id,
  householdId: 'home',
  name: id,
  type,
  currency,
  subtype: type === 'INVESTMENT' ? 'TFSA' : null,
  memberId: id === 'tfsa' ? 'alex' : null,
  balanceSource: 'MANUAL',
  deletedAt: null,
  createdAt: '',
  updatedAt: '',
});
const accounts = [
  account('tfsa', 'INVESTMENT'),
  account('cash', 'SAVINGS'),
  account('loan', 'MORTGAGE'),
  account('usd', 'SAVINGS', 'USD'),
];
const overview: Overview = {
  income: [],
  months: ['2025-12', '2026-01', '2026-02'],
  accounts: [
    { accountId: 'tfsa', balances: ['100.10', '150.15', '200.20'] },
    { accountId: 'cash', balances: ['10.00', '10.00', '10.00'] },
    { accountId: 'loan', balances: [null, '300.00', '290.00'] },
    { accountId: 'usd', balances: ['999.00', '999.00', '999.00'] },
  ],
  expenses: [
    { month: '2026-01', currency: 'CAD', categoryId: null, memberId: null, amount: '0.10' },
    { month: '2026-01', currency: 'CAD', categoryId: null, memberId: 'alex', amount: '0.20' },
    { month: '2026-02', currency: 'USD', categoryId: null, memberId: null, amount: '900.00' },
  ],
};

describe('household overview aggregation', () => {
  it('combines all members and shared accounts, keeps debts negative and currencies separate', () => {
    const result = householdTrends(overview, accounts, [], [], 'CAD');
    expect(result.points.map((point) => point.net)).toEqual([11010n, -13985n, -7980n]);
    expect(result.points[2]?.investments).toBe(20020n);
    expect(result.allocation.map((entry) => entry.value)).toEqual([20020n, 1000n]);
    expect(result.owners.map((entry) => entry.value)).toEqual([20020n, -28000n]);
    expect(result.spending).toEqual([
      { key: 'uncategorized', label: 'Uncategorized', values: [0n, 30n, 0n] },
    ]);
  });

  it('does not present new account observations as growth or invent returns for negative net worth', () => {
    const { points } = householdTrends(overview, accounts, [], [], 'CAD');
    expect(netChange(points, 0)).toBeNull();
    expect(netChange(points, 1)).toEqual({ amount: 6005n, percent: null });
    expect(netChange(points, -1)).toBeNull();
    const positive = householdTrends(overview, [accounts[0]!], [], [], 'CAD').points;
    expect(netChange(positive, 0)).toEqual({ amount: 10010n, percent: 100 });
  });

  it('preserves empty observations as unknown rather than a zero net worth', () => {
    const result = householdTrends(
      { ...overview, accounts: [], expenses: [] },
      accounts,
      [],
      [],
      'CAD',
    );
    expect(result.points.every((point) => point.net === null && point.missing === 3)).toBe(true);
    expect(result.allocation).toEqual([]);
    expect(result.spending).toEqual([]);
    expect(netChange(result.points, 0)).toBeNull();
  });

  it('excludes overdrawn assets from allocation but includes them in net worth', () => {
    const result = householdTrends(
      {
        ...overview,
        accounts: [
          ...overview.accounts.filter((entry) => entry.accountId !== 'cash'),
          { accountId: 'cash', balances: ['-10.00', '-10.00', '-10.00'] },
        ],
      },
      accounts,
      [],
      [],
      'CAD',
    );
    expect(result.allocation.map((entry) => entry.value)).toEqual([20020n]);
    expect(result.points.at(-1)?.net).toBe(-9980n);
  });

  it('combines income and refunds into exact monthly household cash flow without changing balances', () => {
    const result = householdTrends(
      {
        ...overview,
        income: [
          { month: '2026-01', currency: 'CAD', memberId: 'alex', amount: '0.10' },
          { month: '2026-01', currency: 'CAD', memberId: null, amount: '0.20' },
          { month: '2026-01', currency: 'USD', memberId: null, amount: '999.00' },
        ],
        expenses: [
          ...overview.expenses,
          { month: '2026-01', currency: 'CAD', categoryId: null, memberId: null, amount: '-0.10' },
        ],
      },
      accounts,
      [],
      [],
      'CAD',
    );
    expect(result.cashflow[1]).toEqual({ month: '2026-01', income: 30n, expenses: 20n, net: 10n });
    expect(result.points[1]?.net).toBe(-13985n);
  });
});
