import { describe, expect, it } from 'vitest';
import { cents, formatMoney, totals } from './money';
import type { Account, AccountSummary } from './api';

function summary(type: Account['type'], amount: string | null, currency = 'CAD'): AccountSummary {
  const timestamps = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return {
    account: {
      id: 'account',
      householdId: 'home',
      name: 'Bank',
      type,
      subtype: null,
      currency,
      memberId: null,
      balanceSource: 'MANUAL',
      deletedAt: null,
      ...timestamps,
    },
    latest:
      amount === null
        ? null
        : {
            id: 'snapshot',
            householdId: 'home',
            accountId: 'account',
            amount,
            asOf: timestamps.createdAt,
            source: 'MANUAL',
            ...timestamps,
          },
  };
}

describe('precise financial presentation', () => {
  it('uses integer cents without floating point loss', () => {
    expect(cents('999999999999.99') + cents('0.01')).toBe(100000000000000n);
    expect(cents('-0.01')).toBe(-1n);
    expect(() => cents('1.001')).toThrow();
  });
  it('formats negative sub-dollar values and large totals', () => {
    expect(formatMoney(-1n, 'CAD')).toContain('-0.01');
    expect(formatMoney(100000000000000001n, 'CAD')).toContain('1,000,000,000,000,000.01');
  });
  it('subtracts debts, excludes missing data and never mixes currencies', () => {
    expect(
      totals([
        summary('CHEQUING', '1000.10'),
        summary('CREDIT', '100.00'),
        summary('LOAN', '-5.00'),
        summary('SAVINGS', null),
        summary('SAVINGS', '20.00', 'USD'),
      ]),
    ).toEqual([
      { currency: 'CAD', assets: 100010n, debts: 9500n, net: 90510n, missing: 1 },
      { currency: 'USD', assets: 2000n, debts: 0n, net: 2000n, missing: 0 },
    ]);
  });
});
