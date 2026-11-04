import { describe, expect, it } from 'vitest';
import {
  addMonths,
  amortizationProblem,
  calculatedPayment,
  projectMortgage,
  type AmortizationTerms,
} from '../src/domain/mortgage.js';

const terms: AmortizationTerms = {
  principal: '500000.00',
  annualRate: '5',
  compounding: 'SEMI_ANNUAL',
  amortizationMonths: 300,
  termMonths: 60,
  paymentFrequency: 'MONTHLY',
  startDate: '2024-01-15',
  paymentAmount: null,
  propertyValue: null,
};
const cents = (value: string) => Math.round(Number(value) * 100);

describe('mortgage amortization', () => {
  it('computes Canadian semi-annual compounded payments', () => {
    expect(calculatedPayment(terms)).toBe(290802);
    expect(calculatedPayment({ ...terms, paymentFrequency: 'ACCELERATED_WEEKLY' })).toBe(72701);
    expect(calculatedPayment({ ...terms, paymentFrequency: 'ACCELERATED_BIWEEKLY' })).toBe(145401);
    expect(calculatedPayment({ ...terms, annualRate: '0', amortizationMonths: 3 })).toBe(16666667);
  });

  it('clamps monthly due dates to the end of shorter months', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-11-30', 3)).toBe('2025-02-28');
  });

  it('fully repays the principal by the end of the amortization', () => {
    const projection = projectMortgage(terms, [], '2024-01-15');
    expect(projection.payment).toBe('2908.02');
    expect(projection.balance).toBe('500000.00');
    expect(projection.nextPayment).toMatchObject({ date: '2024-02-15', payment: '2908.02' });
    expect(projection.payoffDate).toBe('2049-01-15');
    expect(projection.paymentsRemaining).toBe(300);
    expect(projection.years.at(-1)?.endingBalance).toBe('0.00');
    const principal = projection.years.reduce((total, year) => total + cents(year.principal), 0);
    expect(principal).toBe(50_000_000);
    expect(projection.termEndDate).toBe('2029-01-15');
    expect(Number(projection.balanceAtTermEnd)).toBeGreaterThan(400_000);
    expect(projection.interestSaved).toBe('0.00');
  });

  it('reports paid-to-date figures and equity as of a date', () => {
    const projection = projectMortgage({ ...terms, propertyValue: '800000.00' }, [], '2025-01-20');
    expect(projection.nextPayment?.date).toBe('2025-02-15');
    const paid = cents(projection.interestPaid) + cents(projection.principalPaid);
    expect(paid).toBe(12 * 290802);
    expect(cents(projection.balance)).toBe(50_000_000 - cents(projection.principalPaid));
    expect(cents(projection.equity!)).toBe(80_000_000 - cents(projection.balance));
  });

  it('pays off sooner with accelerated payments and prepayments', () => {
    const regular = projectMortgage(terms, [], '2024-01-15');
    const accelerated = projectMortgage(
      { ...terms, paymentFrequency: 'ACCELERATED_BIWEEKLY' },
      [],
      '2024-01-15',
    );
    expect(accelerated.periodsPerYear).toBe(26);
    expect(accelerated.payoffDate < regular.payoffDate).toBe(true);
    expect(cents(accelerated.totalInterest)).toBeLessThan(cents(regular.totalInterest));

    const prepaid = projectMortgage(
      terms,
      [{ amount: '20000.00', date: '2024-06-01' }],
      '2024-07-01',
    );
    expect(prepaid.prepaid).toBe('20000.00');
    expect(cents(prepaid.interestSaved)).toBeGreaterThan(0);
    expect(prepaid.payoffDate < regular.payoffDate).toBe(true);
    expect(prepaid.baseline).toEqual({
      payoffDate: regular.payoffDate,
      totalInterest: regular.totalInterest,
      years: regular.years.map(({ year, endingBalance }) => ({ year, endingBalance })),
    });
    const balanceIn = (year: number) =>
      cents(prepaid.years.find((entry) => entry.year === year)!.endingBalance);
    const baselineIn = (year: number) =>
      cents(prepaid.baseline.years.find((entry) => entry.year === year)!.endingBalance);
    // The gap compounds at the mortgage rate after the lump sum.
    expect(baselineIn(2024) - balanceIn(2024)).toBeGreaterThan(2_000_000);
    expect(baselineIn(2024) - balanceIn(2024)).toBeLessThan(2_100_000);
    expect(prepaid.years.find((year) => year.year === 2024)?.prepaid).toBe('20000.00');
  });

  it('applies prepayments made since the last regular payment to the current balance', () => {
    const before = projectMortgage(terms, [], '2024-03-01');
    const after = projectMortgage(terms, [{ amount: '1000.00', date: '2024-02-20' }], '2024-03-01');
    expect(cents(before.balance) - cents(after.balance)).toBe(100_000);
    expect(after.prepaid).toBe('1000.00');
  });

  it('caps prepayments at the balance and handles zero-rate loans', () => {
    const projection = projectMortgage(
      { ...terms, principal: '1200.00', annualRate: '0', amortizationMonths: 12 },
      [{ amount: '5000.00', date: '2024-03-01' }],
      '2024-12-31',
    );
    expect(projection.payment).toBe('100.00');
    expect(projection.balance).toBe('0.00');
    expect(projection.totalInterest).toBe('0.00');
    expect(projection.prepaid).toBe('1000.00');
    expect(projection.payoffDate).toBe('2024-03-15');
    expect(projection.nextPayment).toBeNull();
    expect(projection.paymentsRemaining).toBe(0);
  });

  it('honours a lender payment override and rejects payments that never amortize', () => {
    const projection = projectMortgage({ ...terms, paymentAmount: '3500.00' }, [], '2024-01-15');
    expect(projection.payment).toBe('3500.00');
    expect(projection.calculatedPayment).toBe('2908.02');
    expect(projection.payoffDate < '2049-01-15').toBe(true);
    expect(amortizationProblem(terms)).toBeNull();
    expect(amortizationProblem({ ...terms, paymentAmount: '2000.00' })).toMatch(/interest/);
    expect(amortizationProblem({ ...terms, paymentAmount: '2075.00' })).toMatch(/100 years/);
  });

  it('supports weekly schedules', () => {
    const projection = projectMortgage({ ...terms, paymentFrequency: 'WEEKLY' }, [], '2024-01-15');
    expect(projection.nextPayment?.date).toBe('2024-01-22');
    expect(projection.periodsPerYear).toBe(52);
    expect(projection.years.at(-1)?.endingBalance).toBe('0.00');
  });
});
