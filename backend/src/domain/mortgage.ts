import type { CompoundingFrequency, MortgageProjection, PaymentFrequency } from '@studious/api';

/** Pure Canadian mortgage amortization. Money is handled as integer cents. */
export interface AmortizationTerms {
  principal: string;
  annualRate: string;
  compounding: CompoundingFrequency;
  amortizationMonths: number;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
  startDate: string;
  paymentAmount: string | null;
  propertyValue: string | null;
}
export interface ScheduledPrepayment {
  amount: string;
  date: string;
}

type Frequency = { perYear: number; days?: number; monthlyDivisor?: number };
const frequencies: Record<PaymentFrequency, Frequency> = {
  MONTHLY: { perYear: 12 },
  BIWEEKLY: { perYear: 26, days: 14 },
  ACCELERATED_BIWEEKLY: { perYear: 26, days: 14, monthlyDivisor: 2 },
  WEEKLY: { perYear: 52, days: 7 },
  ACCELERATED_WEEKLY: { perYear: 52, days: 7, monthlyDivisor: 4 },
};
const maxYears = 100;

export function toCents(value: string) {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const digits = String(Math.abs(cents)).padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function datePart(date: string) {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function addMonths(date: string, months: number) {
  const { year, month, day } = datePart(date);
  const index = year * 12 + month - 1 + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  // Payments due on the 29th-31st fall on the last day of shorter months.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0'),
  ].join('-');
}

function addDays(date: string, days: number) {
  const { year, month, day } = datePart(date);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Effective rate per payment period for a nominal annual rate compounded `compounding`. */
export function periodicRate(
  annualRate: string,
  compounding: CompoundingFrequency,
  periodsPerYear: number,
) {
  const perYear = compounding === 'MONTHLY' ? 12 : 2;
  return Math.pow(1 + Number(annualRate) / 100 / perYear, perYear / periodsPerYear) - 1;
}

function annuity(principal: number, rate: number, periods: number) {
  if (rate === 0) return Math.ceil(principal / periods);
  return Math.round((principal * rate) / (1 - Math.pow(1 + rate, -periods)));
}

/**
 * The regular payment implied by the terms. Accelerated payments are the monthly payment divided
 * by two or four, which repays the loan faster than an equivalent amortizing schedule.
 */
export function calculatedPayment(terms: AmortizationTerms) {
  const frequency = frequencies[terms.paymentFrequency];
  const principal = toCents(terms.principal);
  if (frequency.monthlyDivisor) {
    const monthly = annuity(
      principal,
      periodicRate(terms.annualRate, terms.compounding, 12),
      terms.amortizationMonths,
    );
    return Math.round(monthly / frequency.monthlyDivisor);
  }
  return annuity(
    principal,
    periodicRate(terms.annualRate, terms.compounding, frequency.perYear),
    Math.max(1, Math.round((terms.amortizationMonths * frequency.perYear) / 12)),
  );
}

function paymentDate(terms: AmortizationTerms, period: number) {
  const { days } = frequencies[terms.paymentFrequency];
  return days ? addDays(terms.startDate, days * period) : addMonths(terms.startDate, period);
}

/** Lenders adjust the last scheduled payment to absorb the residual from rounding to cents. */
function scheduledPeriods(terms: AmortizationTerms) {
  const frequency = frequencies[terms.paymentFrequency];
  if (terms.paymentAmount || frequency.monthlyDivisor) return Infinity;
  return Math.max(1, Math.round((terms.amortizationMonths * frequency.perYear) / 12));
}

function regularPayment(terms: AmortizationTerms) {
  return terms.paymentAmount ? toCents(terms.paymentAmount) : calculatedPayment(terms);
}

/** Returns a reason the terms can never be repaid, or null when they amortize. */
export function amortizationProblem(terms: AmortizationTerms) {
  const { perYear } = frequencies[terms.paymentFrequency];
  const rate = periodicRate(terms.annualRate, terms.compounding, perYear);
  const principal = toCents(terms.principal);
  const payment = regularPayment(terms);
  if (payment <= Math.round(principal * rate)) {
    return 'The regular payment does not cover the interest, so the balance would never decrease';
  }
  const periods =
    rate > 0
      ? -Math.log(1 - (principal * rate) / payment) / Math.log(1 + rate)
      : principal / payment;
  if (!Number.isFinite(periods) || periods > perYear * maxYears) {
    return `The regular payment would take more than ${maxYears} years to repay the principal`;
  }
  return null;
}

interface Row {
  date: string;
  payment: number;
  interest: number;
  principal: number;
  prepaid: number;
  balance: number;
}

function simulate(
  terms: AmortizationTerms,
  payment: number,
  prepayments: { date: string; cents: number }[],
) {
  const { perYear } = frequencies[terms.paymentFrequency];
  const rate = periodicRate(terms.annualRate, terms.compounding, perYear);
  const finalPeriod = scheduledPeriods(terms);
  const rows: Row[] = [];
  let balance = toCents(terms.principal);
  let next = 0;
  for (let period = 1; balance > 0; period++) {
    if (period > perYear * maxYears + 1) throw new Error('Mortgage terms do not amortize');
    const date = paymentDate(terms, period);
    const interest = Math.round(balance * rate);
    const principal = period >= finalPeriod ? balance : Math.min(payment - interest, balance);
    balance -= principal;
    // Lump sums are applied with the regular payment on or after their date.
    let prepaid = 0;
    while (next < prepayments.length && prepayments[next]!.date <= date) {
      const amount = Math.min(prepayments[next]!.cents, balance);
      balance -= amount;
      prepaid += amount;
      next++;
    }
    rows.push({ date, payment: interest + principal, interest, principal, prepaid, balance });
  }
  return rows;
}

const sum = (rows: Row[], key: 'interest' | 'principal' | 'prepaid') =>
  rows.reduce((total, row) => total + row[key], 0);

export function projectMortgage(
  terms: AmortizationTerms,
  prepayments: ScheduledPrepayment[],
  asOf: string,
): MortgageProjection {
  const { perYear } = frequencies[terms.paymentFrequency];
  const payment = regularPayment(terms);
  const lumpSums = prepayments
    .map((prepayment) => ({ date: prepayment.date, cents: toCents(prepayment.amount) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const rows = simulate(terms, payment, lumpSums);
  const baseline = simulate(terms, payment, []);
  const principal = toCents(terms.principal);

  const past = rows.filter((row) => row.date <= asOf);
  const lastPaid = past.at(-1);
  // Prepayments made since the last regular payment already reduce today's balance.
  let balance = lastPaid?.balance ?? principal;
  let pending = 0;
  for (const lumpSum of lumpSums) {
    if (lumpSum.date > (lastPaid?.date ?? '') && lumpSum.date <= asOf && balance > 0) {
      const amount = Math.min(lumpSum.cents, balance);
      balance -= amount;
      pending += amount;
    }
  }
  const upcoming = balance > 0 ? rows.find((row) => row.date > asOf) : undefined;
  const termEndDate = addMonths(terms.startDate, terms.termMonths);
  const atTermEnd = rows.filter((row) => row.date <= termEndDate).at(-1)?.balance ?? principal;
  const totalInterest = sum(rows, 'interest');
  const baselineInterest = sum(baseline, 'interest');

  const years = new Map<number, Row[]>();
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4));
    const yearRows = years.get(year) ?? [];
    yearRows.push(row);
    years.set(year, yearRows);
  }

  return {
    asOf,
    periodsPerYear: perYear,
    payment: fromCents(payment),
    calculatedPayment: fromCents(calculatedPayment(terms)),
    balance: fromCents(balance),
    equity: terms.propertyValue ? fromCents(toCents(terms.propertyValue) - balance) : null,
    interestPaid: fromCents(sum(past, 'interest')),
    principalPaid: fromCents(sum(past, 'principal')),
    prepaid: fromCents(sum(past, 'prepaid') + pending),
    nextPayment: upcoming
      ? {
          date: upcoming.date,
          payment: fromCents(upcoming.payment),
          interest: fromCents(upcoming.interest),
          principal: fromCents(upcoming.principal),
          balance: fromCents(upcoming.balance),
        }
      : null,
    termEndDate,
    balanceAtTermEnd: fromCents(atTermEnd),
    payoffDate: rows.at(-1)!.date,
    paymentsRemaining: balance > 0 ? rows.filter((row) => row.date > asOf).length : 0,
    totalInterest: fromCents(totalInterest),
    baseline: { payoffDate: baseline.at(-1)!.date, totalInterest: fromCents(baselineInterest) },
    interestSaved: fromCents(baselineInterest - totalInterest),
    years: [...years].map(([year, yearRows]) => ({
      year,
      interest: fromCents(sum(yearRows, 'interest')),
      principal: fromCents(sum(yearRows, 'principal')),
      prepaid: fromCents(sum(yearRows, 'prepaid')),
      endingBalance: fromCents(yearRows.at(-1)!.balance),
    })),
  };
}
