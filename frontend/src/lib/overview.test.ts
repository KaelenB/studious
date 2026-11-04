import { describe, expect, it } from 'vitest';
import type { Account, Overview } from '@studious/api';
import {
  householdTrends,
  netChange,
  netWorthProjection,
  investmentProjection,
  accountProjection,
} from './overview';

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
  it('projects only the selected account balance and stops debt repayment at zero', () => {
    expect(accountProjection(overview, accounts[1]!, 12, 100n)!.at(-1)!.balance).toBe(2200n);
    expect(accountProjection(overview, accounts[2]!, 12, -10000n)!.at(-1)!.balance).toBe(0n);
    expect(accountProjection(overview, accounts[1]!, 12, -1000n)!.at(-1)!.balance).toBe(-11000n);
    expect(accountProjection({ ...overview, accounts: [] }, accounts[0]!, 12, 0n)).toBeNull();
  });
  it('compounds investment returns monthly with end-of-month contributions and separates gains', () => {
    const data = {
      ...overview,
      months: ['2026-12'],
      accounts: [{ accountId: 'tfsa', balances: ['1000.00'] }],
    };
    const result = investmentProjection(data, accounts, 'CAD', 12, 12, 10000n)!;
    expect(result.points[0]!.balance).toBe(100000n);
    expect(result.points[1]!.balance).toBe(110949n);
    const last = result.points.at(-1)!;
    expect(last.month).toBe('2027-12');
    expect(last.contributions).toBe(120000n);
    expect(last.gains).toBe(last.balance - 220000n);
    expect(
      Math.abs(
        Number(last.balance) - (100000 * 1.12 + (10000 * (1.12 - 1)) / (1.12 ** (1 / 12) - 1)),
      ),
    ).toBeLessThan(3);
    expect(investmentProjection(data, accounts, 'CAD', 12, 0, 10000n)!.points.at(-1)!.balance).toBe(
      220000n,
    );
    expect(investmentProjection(data, accounts, 'CAD', 12, -100, 0n)!.points.at(-1)!.balance).toBe(
      0n,
    );
    expect(
      investmentProjection(data, accounts, 'CAD', 12, -10, 0n)!.points.at(-1)!.balance,
    ).toBeLessThan(100000n);
    expect(investmentProjection(data, accounts, 'USD', 12, 5, 0n)).toBeNull();
    expect(investmentProjection({ ...data, accounts: [] }, accounts, 'CAD', 12, 5, 0n)).toBeNull();
    expect(() => investmentProjection(data, accounts, 'CAD', 12, -101, 0n)).toThrow();
    expect(() => investmentProjection(data, accounts, 'CAD', 12, 5, -1n)).toThrow();
  });
  it('projects exact signed monthly changes across years without altering balances', () => {
    const result = netWorthProjection(overview, accounts, 'CAD', 12, -101n)!;
    expect(result.basis).toBe('manual');
    expect(result.points[0]).toEqual({ month: '2026-02', net: -7980n });
    expect(result.points.at(-1)).toEqual({ month: '2027-02', net: -9192n });
    expect(overview.accounts[0]!.balances.at(-1)).toBe('200.20');
    expect(netWorthProjection(overview, accounts, 'CAD', 12)!.basis).toBe('flat');
    expect(netWorthProjection({ ...overview, accounts: [] }, accounts, 'CAD', 12)).toBeNull();
    const partial = netWorthProjection(
      { ...overview, accounts: overview.accounts.slice(1) },
      accounts,
      'CAD',
      12,
    )!;
    expect(partial.missingAccounts).toBe(1);
    expect(partial.points).toHaveLength(13);
    expect(partial.points[0]).toEqual({ month: '2026-02', net: -28000n });
  });

  it('uses only paired completed months in the trailing year, excluding other currencies and partial months', () => {
    const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
    const data: Overview = {
      months,
      accounts: [{ accountId: 'cash', balances: months.map(() => '100.00') }],
      income: months.map((month) => ({ month, currency: 'CAD', memberId: null, amount: '100.01' })),
      expenses: months.map((month) => ({
        month,
        currency: 'CAD',
        memberId: null,
        categoryId: null,
        amount: '50.00',
      })),
    };
    const result = netWorthProjection(data, [accounts[1]!], 'CAD', 12)!;
    expect(result.sampleMonths).toEqual(months.slice(0, -1));
    expect(result.monthlyChange).toBe(5001n);
    expect(result.points.at(-1)!.net).toBe(70012n);
    data.income[0]!.currency = 'USD';
    expect(netWorthProjection(data, [accounts[1]!], 'CAD', 12)!.sampleMonths).toHaveLength(3);
    data.income[1]!.currency = 'USD';
    expect(netWorthProjection(data, [accounts[1]!], 'CAD', 12)!.basis).toBe('flat');
  });

  it('caps the forecast at the supported calendar boundary', () => {
    const data = {
      ...overview,
      months: ['9999-12'],
      accounts: [{ accountId: 'cash', balances: ['1.00'] }],
    };
    expect(netWorthProjection(data, [accounts[1]!], 'CAD', 60, 100n)!.points).toEqual([
      { month: '9999-12', net: 100n },
    ]);
  });
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
