import {
  createApiClient,
  type Account,
  type CompoundingFrequency,
  type InvestmentSubtype,
  type PaymentFrequency,
  type RateType,
  type Snapshot,
} from '@studious/api';

export {
  accountTypes,
  investmentSubtypes,
  compoundingFrequencies,
  paymentFrequencies,
  rateTypes,
  ratePattern,
  moneyPattern,
  ApiError,
  type Household,
  type Member,
  type Account,
  type Snapshot,
  type AccountInput,
  type InvestmentSubtype,
  type Mortgage,
  type MortgageProjection,
  type MortgageTerms,
  type MortgageTermsInput,
  type Prepayment,
} from '@studious/api';

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = createApiClient(apiBaseUrl);

export const accountLabels: Record<Account['type'], string> = {
  CHEQUING: 'Chequing',
  SAVINGS: 'Savings',
  INVESTMENT: 'Investment',
  CREDIT: 'Credit',
  LOAN: 'Loan',
  MORTGAGE: 'Mortgage',
};

export const subtypeLabels: Record<InvestmentSubtype, string> = {
  TFSA: 'TFSA',
  RRSP: 'RRSP',
  SPOUSAL_RRSP: 'Spousal RRSP',
  GROUP_RRSP: 'Group RRSP',
  FHSA: 'FHSA',
  RESP: 'RESP',
  RDSP: 'RDSP',
  RRIF: 'RRIF',
  LIRA: 'LIRA',
  LIF: 'LIF',
  DCPP: 'DCPP',
  DBPP: 'DBPP',
  DPSP: 'DPSP',
  NON_REGISTERED: 'Non-registered',
};

export const subtypeDescriptions: Record<InvestmentSubtype, string> = {
  TFSA: 'Tax-Free Savings Account',
  RRSP: 'Registered Retirement Savings Plan',
  SPOUSAL_RRSP: 'Spousal RRSP',
  GROUP_RRSP: 'Group RRSP (workplace)',
  FHSA: 'First Home Savings Account',
  RESP: 'Registered Education Savings Plan',
  RDSP: 'Registered Disability Savings Plan',
  RRIF: 'Registered Retirement Income Fund',
  LIRA: 'Locked-In Retirement Account',
  LIF: 'Life Income Fund',
  DCPP: 'Defined Contribution Pension Plan',
  DBPP: 'Defined Benefit Pension Plan',
  DPSP: 'Deferred Profit Sharing Plan',
  NON_REGISTERED: 'Non-registered (taxable)',
};

export const paymentFrequencyLabels: Record<PaymentFrequency, string> = {
  MONTHLY: 'Monthly',
  BIWEEKLY: 'Bi-weekly',
  ACCELERATED_BIWEEKLY: 'Accelerated bi-weekly',
  WEEKLY: 'Weekly',
  ACCELERATED_WEEKLY: 'Accelerated weekly',
};

export const rateTypeLabels: Record<RateType, string> = { FIXED: 'Fixed', VARIABLE: 'Variable' };

export const compoundingLabels: Record<CompoundingFrequency, string> = {
  SEMI_ANNUAL: 'Semi-annual (Canadian fixed)',
  MONTHLY: 'Monthly',
};

/** Formats a month count such as 300 as "25 years" or 66 as "5 years 6 months". */
export function durationLabel(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest || !years) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}

export function accountKind(account: Pick<Account, 'type' | 'subtype'>) {
  const base = accountLabels[account.type];
  return account.subtype ? `${base} \u00b7 ${subtypeLabels[account.subtype]}` : base;
}

export type AccountSummary = { account: Account; latest: Snapshot | null };

export function errorMessage(
  error: unknown,
  baseUrl = apiBaseUrl,
  origin = globalThis.location?.origin ?? 'this site',
) {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';
  // Hosted builds (e.g. GitHub Pages) call the central API by absolute URL; say which one.
  if (error.message.startsWith('Cannot reach the backend') && /^https?:\/\//.test(baseUrl)) {
    return `Cannot reach the Studious API at ${baseUrl}. Check that it is running and reachable from this device, and that its CORS_ORIGINS includes ${origin}.`;
  }
  return error.message;
}
