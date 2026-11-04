import { z } from 'zod';

export const accountTypes = [
  'CHEQUING',
  'SAVINGS',
  'INVESTMENT',
  'CREDIT',
  'LOAN',
  'MORTGAGE',
] as const;
export const balanceSources = ['MANUAL', 'PROJECTED', 'INTEGRATED'] as const;
/** Canadian plan kinds for `INVESTMENT` accounts; `null` means unspecified. */
export const investmentSubtypes = [
  'TFSA',
  'RRSP',
  'SPOUSAL_RRSP',
  'GROUP_RRSP',
  'FHSA',
  'RESP',
  'RDSP',
  'RRIF',
  'LIRA',
  'LIF',
  'DCPP',
  'DBPP',
  'DPSP',
  'NON_REGISTERED',
] as const;
export const moneyPattern = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
const name = z.string().trim().min(1).max(200);
const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code');
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
const source = z.enum(balanceSources);
const subtype = z.enum(investmentSubtypes).nullable();
const subtypeMessage = 'Only investment accounts can have a sub-type';

export const householdBody = z.strictObject({
  name,
  defaultCurrency: currency.default('CAD'),
});
export const memberBody = z.strictObject({ name });
export const accountBody = z
  .strictObject({
    name,
    type: z.enum(accountTypes),
    subtype: subtype.optional(),
    currency: currency.default('CAD'),
    memberId: z.uuid().nullable().optional(),
    balanceSource: z.literal('MANUAL').default('MANUAL'),
  })
  .refine((value) => value.subtype == null || value.type === 'INVESTMENT', {
    message: subtypeMessage,
    path: ['subtype'],
  });
export const accountUpdateBody = z
  .strictObject({
    name: name.optional(),
    memberId: z.uuid().nullable().optional(),
    subtype: subtype.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export const snapshotBody = z.strictObject({
  amount: z.string().regex(moneyPattern, 'Use a decimal string with two places'),
  asOf: z.iso.datetime({ offset: true }),
});
export const householdParams = z.object({ householdId: z.uuid() });
export const accountParams = householdParams.extend({ accountId: z.uuid() });
export const historyQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});

export const householdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  defaultCurrency: z.string(),
  ...timestamps,
});
export const memberSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  name: z.string(),
  ...timestamps,
});
export const accountSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  memberId: z.uuid().nullable(),
  name: z.string(),
  type: z.enum(accountTypes),
  // Defaults keep clients compatible with API builds that predate sub-types.
  subtype: subtype.default(null),
  currency: z.string(),
  balanceSource: source,
  deletedAt: z.iso.datetime().nullable(),
  ...timestamps,
});
export const snapshotSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  accountId: z.uuid(),
  amount: z.string().regex(moneyPattern),
  asOf: z.iso.datetime(),
  source,
  ...timestamps,
});
export const healthSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('ok'),
});
export const storageSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
});
export type Storage = z.infer<typeof storageSchema>;

export type Household = z.infer<typeof householdSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Account = z.infer<typeof accountSchema>;
export type InvestmentSubtype = (typeof investmentSubtypes)[number];
export type Snapshot = z.infer<typeof snapshotSchema>;
export type HouseholdInput = z.input<typeof householdBody>;
export type MemberInput = z.input<typeof memberBody>;
export type AccountInput = z.input<typeof accountBody>;
export type AccountUpdate = z.input<typeof accountUpdateBody>;
export type SnapshotInput = z.input<typeof snapshotBody>;

export const expenseCategoryBody = z.strictObject({ name });
export const expenseBody = z.strictObject({
  name,
  amount: z
    .string()
    .regex(moneyPattern, 'Use a decimal string with two places')
    .refine(
      (value) => !['0.00', '-0.00'].includes(value),
      'Amount must be non-zero; use negative amounts for refunds',
    ),
  currency: currency.default('CAD'),
  startDate: z.iso.date().refine((value) => value >= '1000-01-01', 'Use a year from 1000 to 9999'),
  memberId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
});
export const expenseUpdateBody = expenseBody
  .omit({ currency: true })
  .partial()
  .extend({ currency: currency.optional() })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export const expenseParams = householdParams.extend({ expenseId: z.uuid() });
export const expenseQuery = historyQuery.extend({
  month: z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
});
export const expenseCategorySchema = memberSchema;
export const expenseSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  name: z.string(),
  amount: z.string().regex(moneyPattern),
  currency: z.string(),
  startDate: z.iso.date(),
  memberId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  ...timestamps,
});
export const expensePageSchema = z.object({
  items: z.array(expenseSchema),
  totals: z.array(
    z.object({
      currency: z.string(),
      amount: z.string().regex(/^-?\d+\.\d{2}$/),
    }),
  ),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseInput = z.input<typeof expenseBody>;
export type ExpenseUpdate = z.input<typeof expenseUpdateBody>;
export type ExpensePage = z.infer<typeof expensePageSchema>;

export const incomeBody = expenseBody.omit({ categoryId: true }).extend({
  amount: z
    .string()
    .regex(moneyPattern)
    .refine((value) => !value.startsWith('-') && value !== '0.00', 'Income must be positive'),
});
export const incomeUpdateBody = incomeBody
  .omit({ currency: true })
  .partial()
  .extend({ currency: currency.optional() })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export const incomeParams = householdParams.extend({ incomeId: z.uuid() });
export const incomeSchema = expenseSchema.omit({ categoryId: true });
export const incomePageSchema = expensePageSchema.extend({ items: z.array(incomeSchema) });
export type Income = z.infer<typeof incomeSchema>;
export type IncomeInput = z.input<typeof incomeBody>;
export type IncomeUpdate = z.input<typeof incomeUpdateBody>;
export type IncomePage = z.infer<typeof incomePageSchema>;

export const statementFileLimit = 10 * 1024 * 1024;
export const statementQuery = z.strictObject({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^/\\\x00-\x1f\x7f]+\.(?:pdf|xlsx)$/i, 'Use a PDF or XLSX filename without paths'),
  statementDate: z.iso
    .date()
    .refine((value) => value >= '1000-01-01')
    .optional(),
});
export const statementParams = accountParams.extend({ statementId: z.uuid() });
export const statementInvestmentSchema = z.object({
  symbol: z.string().min(1).max(40).optional(),
  currency: z.enum(['CAD', 'USD']).optional(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(200).nullable(),
  units: z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/),
  unitPrice: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/),
  value: z.string().regex(moneyPattern),
});
export type StatementInvestment = z.infer<typeof statementInvestmentSchema>;
export const statementPreviewSchema = z.object({
  questrade: z
    .object({
      accountType: z.string(),
      fxRate: z.string(),
      cashCAD: z.string().regex(moneyPattern),
      cashUSD: z.string().regex(moneyPattern),
      combinedCashCAD: z.string().regex(moneyPattern),
    })
    .optional(),
  amount: z.string().regex(moneyPattern),
  statementDate: z.iso.date(),
  currency: z.literal('CAD'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  investments: z.array(statementInvestmentSchema).min(1).max(500).nullable(),
});
export const statementSchema = statementPreviewSchema.extend({
  provider: z.enum(['SUNLIFE', 'QUESTRADE']),
  id: z.uuid(),
  householdId: z.uuid(),
  accountId: z.uuid(),
  snapshotId: z.uuid(),
  filename: z.string(),
  byteLength: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type StatementPreview = z.infer<typeof statementPreviewSchema>;
export type StatementArchive = z.infer<typeof statementSchema>;

export const rateTypes = ['FIXED', 'VARIABLE'] as const;
/** Canadian fixed-rate mortgages compound semi-annually; variable-rate lenders may compound monthly. */
export const compoundingFrequencies = ['SEMI_ANNUAL', 'MONTHLY'] as const;
export const paymentFrequencies = [
  'MONTHLY',
  'BIWEEKLY',
  'ACCELERATED_BIWEEKLY',
  'WEEKLY',
  'ACCELERATED_WEEKLY',
] as const;
/** Annual percentage rate such as `4.79`, from 0 to 30 with up to three decimals. */
export const ratePattern = /^(?:\d|[12]\d|30)(?:\.\d{1,3})?$/;
const positiveMoney = z
  .string()
  .regex(moneyPattern, 'Use a decimal string with two places')
  .refine((value) => !value.startsWith('-') && value !== '0.00', 'Amount must be positive');
const calendarDate = z.iso
  .date()
  .refine((value) => value >= '1000-01-01', 'Use a year from 1000 to 9999');

export const mortgageTermsBody = z.strictObject({
  principal: positiveMoney,
  annualRate: z
    .string()
    .regex(ratePattern, 'Use an annual percentage such as 4.79')
    .refine((value) => Number(value) <= 30, 'Rate must be 30% or lower'),
  rateType: z.enum(rateTypes).default('FIXED'),
  compounding: z.enum(compoundingFrequencies).default('SEMI_ANNUAL'),
  amortizationMonths: z.number().int().min(1).max(600),
  termMonths: z.number().int().min(1).max(120),
  paymentFrequency: z.enum(paymentFrequencies).default('MONTHLY'),
  startDate: calendarDate,
  /** Lender's actual regular payment; null derives it from the terms. */
  paymentAmount: positiveMoney.nullable().default(null),
  /** Current property value used for equity; null hides equity. */
  propertyValue: positiveMoney.nullable().default(null),
});
export const prepaymentBody = z.strictObject({
  amount: positiveMoney,
  date: calendarDate,
  note: z.string().trim().max(200).nullable().default(null),
});
export const mortgageQuery = z.strictObject({ asOf: calendarDate.optional() });
export const prepaymentParams = accountParams.extend({ prepaymentId: z.uuid() });

const money = z.string().regex(moneyPattern);
export const mortgageTermsSchema = z.object({
  accountId: z.uuid(),
  householdId: z.uuid(),
  principal: money,
  annualRate: z.string().regex(ratePattern),
  rateType: z.enum(rateTypes),
  compounding: z.enum(compoundingFrequencies),
  amortizationMonths: z.number().int(),
  termMonths: z.number().int(),
  paymentFrequency: z.enum(paymentFrequencies),
  startDate: z.iso.date(),
  paymentAmount: money.nullable(),
  propertyValue: money.nullable(),
  ...timestamps,
});
export const prepaymentSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  accountId: z.uuid(),
  amount: money,
  date: z.iso.date(),
  note: z.string().nullable(),
  ...timestamps,
});
const paymentSchema = z.object({
  date: z.iso.date(),
  payment: money,
  interest: money,
  principal: money,
  balance: money,
});
export const mortgageProjectionSchema = z.object({
  asOf: z.iso.date(),
  periodsPerYear: z.number().int().positive(),
  /** Regular payment used by the projection (the lender amount when supplied). */
  payment: money,
  calculatedPayment: money,
  balance: money,
  equity: money.nullable(),
  interestPaid: money,
  principalPaid: money,
  prepaid: money,
  nextPayment: paymentSchema.nullable(),
  termEndDate: z.iso.date(),
  balanceAtTermEnd: money,
  payoffDate: z.iso.date(),
  paymentsRemaining: z.number().int().nonnegative(),
  totalInterest: money,
  /** Same terms without any prepayments, to show their effect. */
  baseline: z.object({
    payoffDate: z.iso.date(),
    totalInterest: money,
    /** Year-end balances without prepayments (empty from servers older than 0.9.0). */
    years: z.array(z.object({ year: z.number().int(), endingBalance: money })).default([]),
  }),
  interestSaved: money,
  years: z.array(
    z.object({
      year: z.number().int(),
      interest: money,
      principal: money,
      prepaid: money,
      endingBalance: money,
    }),
  ),
});
export const mortgageSchema = z.object({
  terms: mortgageTermsSchema.nullable(),
  prepayments: z.array(prepaymentSchema),
  projection: mortgageProjectionSchema.nullable(),
});
export type RateType = (typeof rateTypes)[number];
export type CompoundingFrequency = (typeof compoundingFrequencies)[number];
export type PaymentFrequency = (typeof paymentFrequencies)[number];
export type MortgageTermsInput = z.input<typeof mortgageTermsBody>;
export type MortgageTerms = z.infer<typeof mortgageTermsSchema>;
export type PrepaymentInput = z.input<typeof prepaymentBody>;
export type Prepayment = z.infer<typeof prepaymentSchema>;
export type MortgageProjection = z.infer<typeof mortgageProjectionSchema>;
export type MortgagePayment = z.infer<typeof paymentSchema>;
export type Mortgage = z.infer<typeof mortgageSchema>;

const yearMonth = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const overviewQuery = z
  .strictObject({
    months: z.coerce.number().int().min(1).max(120).default(12),
    /** Day whose month is the last point; defaults to today (UTC). */
    asOf: calendarDate.optional(),
  })
  .refine(({ months, asOf }) => {
    if (!asOf) return true;
    const year = Number(asOf.slice(0, 4));
    const month = Number(asOf.slice(5, 7));
    return year * 12 + month - months >= 1000 * 12;
  }, 'The overview window must start in year 1000 or later');
export const overviewSchema = z.object({
  /** Oldest first; the last entry is the month containing `asOf`. */
  months: z.array(yearMonth),
  /** Month-end balances, capped at asOf for the last month; null before the first observation. */
  accounts: z.array(z.object({ accountId: z.uuid(), balances: z.array(money.nullable()) })),
  /** Expense totals grouped by month, currency, category and member. */
  expenses: z.array(
    z.object({
      month: yearMonth,
      currency: z.string(),
      categoryId: z.uuid().nullable(),
      memberId: z.uuid().nullable(),
      amount: z.string().regex(/^-?\d+\.\d{2}$/),
    }),
  ),
  income: z
    .array(
      z.object({
        month: yearMonth,
        currency: z.string(),
        memberId: z.uuid().nullable(),
        amount: z.string().regex(/^\d+\.\d{2}$/),
      }),
    )
    .default([]),
});
export type OverviewInput = z.input<typeof overviewQuery>;
export type Overview = z.infer<typeof overviewSchema>;

export const budgetFileLimit = 10 * 1024 * 1024;
export const budgetUploadQuery = z.strictObject({
  filename: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^/\\\x00-\x1f]+\.xlsx$/i, 'Choose an XLSX workbook'),
  currency: currency.default('CAD'),
});
export const budgetMemberMapping = z
  .record(z.string().min(1).max(200), z.union([z.uuid(), z.literal('CREATE'), z.null()]))
  .refine((value) => Object.keys(value).length <= 50, 'Too many member mappings');
export const budgetConfirmQuery = budgetUploadQuery.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  members: z
    .string()
    .max(12000)
    .transform((value, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Member mapping must be JSON' });
        return z.NEVER;
      }
      const result = budgetMemberMapping.safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({ code: 'custom', message: 'Invalid member mapping' });
        return z.NEVER;
      }
      return result.data;
    }),
});
export const budgetRowSchema = z.object({
  sheet: z.enum(['Expenses', 'Income']),
  row: z.number().int().positive(),
  date: z.iso.date(),
  amount: money,
  name: z.string(),
  category: z.string().nullable(),
  owner: z.string(),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  duplicate: z.boolean(),
});
export const budgetPreviewSchema = z.object({
  sha256: z.string(),
  currency: z.string(),
  rows: z.array(budgetRowSchema),
  issues: z.array(z.object({ sheet: z.string(), row: z.number().int(), message: z.string() })),
  warnings: z.array(z.string()),
  owners: z.array(z.string()),
  totals: z.array(
    z.object({
      sheet: z.enum(['Expenses', 'Income']),
      amount: z.string().regex(/^-?\d+\.\d{2}$/),
      count: z.number().int(),
    }),
  ),
});
export const budgetImportSchema = z.object({
  expenses: z.number().int().nonnegative(),
  income: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});
export type BudgetPreview = z.infer<typeof budgetPreviewSchema>;
export type BudgetRow = z.infer<typeof budgetRowSchema>;
export type BudgetMemberMapping = z.infer<typeof budgetMemberMapping>;
