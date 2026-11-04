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
export const moneyPattern = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
const name = z.string().trim().min(1).max(200);
const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code');
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
const source = z.enum(balanceSources);

export const householdBody = z.strictObject({
  name,
  defaultCurrency: currency.default('CAD'),
});
export const memberBody = z.strictObject({ name });
export const accountBody = z.strictObject({
  name,
  type: z.enum(accountTypes),
  currency: currency.default('CAD'),
  memberId: z.uuid().nullable().optional(),
  balanceSource: z.literal('MANUAL').default('MANUAL'),
});
export const accountUpdateBody = z
  .strictObject({
    name: name.optional(),
    memberId: z.uuid().nullable().optional(),
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

export type Household = z.infer<typeof householdSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Account = z.infer<typeof accountSchema>;
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
    .refine((value) => !value.startsWith('-') && value !== '0.00', 'Amount must be positive'),
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
      amount: z.string().regex(/^\d+\.\d{2}$/),
    }),
  ),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseInput = z.input<typeof expenseBody>;
export type ExpenseUpdate = z.input<typeof expenseUpdateBody>;
export type ExpensePage = z.infer<typeof expensePageSchema>;

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
