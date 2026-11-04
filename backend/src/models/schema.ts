import { sql } from 'drizzle-orm';
import {
  accountTypes,
  balanceSources,
  compoundingFrequencies,
  investmentSubtypes,
  paymentFrequencies,
  rateTypes,
  type StatementInvestment,
  type StatementPreview,
} from '@studious/api';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const instant = (name: string) => integer(name, { mode: 'timestamp_ms' });
const timestamps = () => ({
  createdAt: instant('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: instant('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
const currencyCheck = (name: string, column: unknown) =>
  check(name, sql`${column} GLOB '[A-Z][A-Z][A-Z]'`);
const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));
/** Money is stored as the canonical two-place decimal string from the API contract. */
const money = (name: string) => text(name).notNull();
const moneyCheck = (name: string, column: unknown) =>
  check(name, sql`${column} GLOB '*[0-9].[0-9][0-9]' AND length(${column}) <= 16`);

export const households = sqliteTable(
  'households',
  {
    id: id(),
    name: text('name').notNull(),
    defaultCurrency: text('default_currency').notNull().default('CAD'),
    ...timestamps(),
  },
  (table) => [
    check('households_name_not_blank', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
    currencyCheck('households_currency_format', table.defaultCurrency),
  ],
);

export const members = sqliteTable(
  'members',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('members_household_id_id_unique').on(table.householdId, table.id),
    check('members_name_not_blank', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
  ],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    memberId: text('member_id'),
    name: text('name').notNull(),
    type: text('type', { enum: accountTypes }).notNull(),
    subtype: text('subtype', { enum: investmentSubtypes }),
    currency: text('currency').notNull().default('CAD'),
    balanceSource: text('balance_source', { enum: balanceSources }).notNull().default('MANUAL'),
    ...timestamps(),
    deletedAt: instant('deleted_at'),
  },
  (table) => [
    unique('accounts_household_id_id_unique').on(table.householdId, table.id),
    unique('accounts_household_id_type_unique').on(table.householdId, table.id, table.type),
    foreignKey({
      name: 'accounts_member_household_fk',
      columns: [table.householdId, table.memberId],
      foreignColumns: [members.householdId, members.id],
    }),
    check('accounts_name_not_blank', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
    check('accounts_type_valid', sql`${table.type} IN (${inList(accountTypes)})`),
    check(
      'accounts_subtype_valid',
      sql`${table.subtype} IS NULL OR (${table.type} = 'INVESTMENT' AND ${table.subtype} IN (${inList(investmentSubtypes)}))`,
    ),
    check(
      'accounts_balance_source_valid',
      sql`${table.balanceSource} IN (${inList(balanceSources)})`,
    ),
    currencyCheck('accounts_currency_format', table.currency),
  ],
);

export const balanceSnapshots = sqliteTable(
  'balance_snapshots',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    accountId: text('account_id').notNull(),
    amount: money('amount'),
    asOf: instant('as_of').notNull(),
    source: text('source', { enum: balanceSources }).notNull().default('MANUAL'),
    ...timestamps(),
  },
  (table) => [
    unique('balance_snapshots_household_account_id_unique').on(
      table.householdId,
      table.accountId,
      table.id,
    ),
    foreignKey({
      name: 'balance_snapshots_account_household_fk',
      columns: [table.householdId, table.accountId],
      foreignColumns: [accounts.householdId, accounts.id],
    }),
    moneyCheck('balance_snapshots_amount_format', table.amount),
    check('balance_snapshots_source_valid', sql`${table.source} IN (${inList(balanceSources)})`),
    index('balance_snapshots_account_as_of_idx').on(table.householdId, table.accountId, table.asOf),
  ],
);

export type Household = typeof households.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;

export type NewHousehold = Pick<Household, 'name' | 'defaultCurrency'>;
export type NewMember = Pick<Member, 'name'>;
export type NewAccount = Pick<Account, 'name' | 'type' | 'currency' | 'balanceSource'> &
  Partial<Pick<Account, 'memberId' | 'subtype'>>;
export type AccountUpdate = Partial<Pick<Account, 'name' | 'memberId' | 'subtype'>>;
export type NewBalanceSnapshot = Pick<BalanceSnapshot, 'amount' | 'asOf'>;

export const expenseCategories = sqliteTable(
  'expense_categories',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('expense_categories_household_id_id_unique').on(table.householdId, table.id),
    unique('expense_categories_household_name_unique').on(table.householdId, table.name),
    check('expense_categories_name_not_blank', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: id(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    memberId: text('member_id'),
    categoryId: text('category_id'),
    name: text('name').notNull(),
    amount: money('amount'),
    currency: text('currency').notNull().default('CAD'),
    startDate: text('start_date').notNull(),
    ...timestamps(),
    deletedAt: instant('deleted_at'),
  },
  (table) => [
    foreignKey({
      name: 'expenses_member_household_fk',
      columns: [table.householdId, table.memberId],
      foreignColumns: [members.householdId, members.id],
    }),
    foreignKey({
      name: 'expenses_category_household_fk',
      columns: [table.householdId, table.categoryId],
      foreignColumns: [expenseCategories.householdId, expenseCategories.id],
    }),
    check('expenses_name_not_blank', sql`length(trim(${table.name})) BETWEEN 1 AND 200`),
    moneyCheck('expenses_amount_format', table.amount),
    check('expenses_amount_positive', sql`CAST(${table.amount} AS REAL) > 0`),
    currencyCheck('expenses_currency_format', table.currency),
    check('expenses_start_date_format', sql`date(${table.startDate}) IS ${table.startDate}`),
    index('expenses_household_date_idx').on(table.householdId, table.startDate, table.id),
  ],
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Expense = typeof expenses.$inferSelect;

// Portable blob column: Drizzle's buffer mode depends on Node's Buffer, which browsers lack.
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'blob',
  fromDriver: (value) => (value instanceof Uint8Array ? value : new Uint8Array(value)),
});

export const statementArchives = sqliteTable(
  'statement_archives',
  {
    id: id(),
    householdId: text('household_id').notNull(),
    accountId: text('account_id').notNull(),
    snapshotId: text('snapshot_id').notNull(),
    filename: text('filename').notNull(),
    sha256: text('sha256').notNull(),
    amount: money('amount'),
    statementDate: text('statement_date').notNull(),
    currency: text('currency').notNull(),
    byteLength: integer('byte_length').notNull(),
    /** Original uploaded document (PDF or XLSX) despite the historical column name. */
    pdf: bytes('pdf').notNull(),
    investments: text('investments', { mode: 'json' }).$type<StatementInvestment[]>(),
    provider: text('provider').notNull().default('SUNLIFE'),
    questrade: text('questrade', { mode: 'json' }).$type<
      NonNullable<StatementPreview['questrade']>
    >(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'statement_archives_snapshot_household_account_fk',
      columns: [table.householdId, table.accountId, table.snapshotId],
      foreignColumns: [
        balanceSnapshots.householdId,
        balanceSnapshots.accountId,
        balanceSnapshots.id,
      ],
    }),
    unique('statement_archives_account_hash_unique').on(
      table.householdId,
      table.accountId,
      table.sha256,
    ),
    unique('statement_archives_snapshot_unique').on(table.snapshotId),
    check(
      'statement_archives_size_valid',
      sql`${table.byteLength} = length(${table.pdf}) AND ${table.byteLength} > 0 AND ${table.byteLength} <= 10485760`,
    ),
    check('statement_archives_provider_valid', sql`${table.provider} IN ('SUNLIFE', 'QUESTRADE')`),
    moneyCheck('statement_archives_amount_format', table.amount),
    index('statement_archives_account_created_idx').on(
      table.householdId,
      table.accountId,
      table.createdAt,
    ),
  ],
);

const dateCheck = (name: string, column: unknown) =>
  check(name, sql`date(${column}) IS ${column} AND ${column} >= '1000-01-01'`);
const positiveCheck = (name: string, column: unknown) =>
  check(name, sql`CAST(${column} AS REAL) > 0`);

/** One set of amortization terms per mortgage account; only MORTGAGE accounts can reference it. */
export const mortgageTerms = sqliteTable(
  'mortgage_terms',
  {
    id: id(),
    householdId: text('household_id').notNull(),
    accountId: text('account_id').notNull(),
    accountType: text('account_type', { enum: ['MORTGAGE'] })
      .notNull()
      .default('MORTGAGE'),
    principal: money('principal'),
    annualRate: text('annual_rate').notNull(),
    rateType: text('rate_type', { enum: rateTypes }).notNull().default('FIXED'),
    compounding: text('compounding', { enum: compoundingFrequencies })
      .notNull()
      .default('SEMI_ANNUAL'),
    amortizationMonths: integer('amortization_months').notNull(),
    termMonths: integer('term_months').notNull(),
    paymentFrequency: text('payment_frequency', { enum: paymentFrequencies })
      .notNull()
      .default('MONTHLY'),
    startDate: text('start_date').notNull(),
    paymentAmount: text('payment_amount'),
    propertyValue: text('property_value'),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'mortgage_terms_account_fk',
      columns: [table.householdId, table.accountId, table.accountType],
      foreignColumns: [accounts.householdId, accounts.id, accounts.type],
    }),
    unique('mortgage_terms_account_unique').on(table.accountId),
    unique('mortgage_terms_household_account_unique').on(table.householdId, table.accountId),
    check('mortgage_terms_account_type_valid', sql`${table.accountType} = 'MORTGAGE'`),
    moneyCheck('mortgage_terms_principal_format', table.principal),
    positiveCheck('mortgage_terms_principal_positive', table.principal),
    check(
      'mortgage_terms_rate_valid',
      sql`${table.annualRate} GLOB '[0-9]*' AND CAST(${table.annualRate} AS REAL) BETWEEN 0 AND 30`,
    ),
    check('mortgage_terms_rate_type_valid', sql`${table.rateType} IN (${inList(rateTypes)})`),
    check(
      'mortgage_terms_compounding_valid',
      sql`${table.compounding} IN (${inList(compoundingFrequencies)})`,
    ),
    check(
      'mortgage_terms_frequency_valid',
      sql`${table.paymentFrequency} IN (${inList(paymentFrequencies)})`,
    ),
    check('mortgage_terms_amortization_valid', sql`${table.amortizationMonths} BETWEEN 1 AND 600`),
    check('mortgage_terms_term_valid', sql`${table.termMonths} BETWEEN 1 AND 120`),
    dateCheck('mortgage_terms_start_date_format', table.startDate),
    check(
      'mortgage_terms_payment_valid',
      sql`${table.paymentAmount} IS NULL OR (${table.paymentAmount} GLOB '*[0-9].[0-9][0-9]' AND CAST(${table.paymentAmount} AS REAL) > 0)`,
    ),
    check(
      'mortgage_terms_property_value_valid',
      sql`${table.propertyValue} IS NULL OR (${table.propertyValue} GLOB '*[0-9].[0-9][0-9]' AND CAST(${table.propertyValue} AS REAL) > 0)`,
    ),
  ],
);

/** Planned or completed lump-sum payments. These are planning inputs, so deletes are hard. */
export const mortgagePrepayments = sqliteTable(
  'mortgage_prepayments',
  {
    id: id(),
    householdId: text('household_id').notNull(),
    accountId: text('account_id').notNull(),
    amount: money('amount'),
    date: text('date').notNull(),
    note: text('note'),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'mortgage_prepayments_terms_fk',
      columns: [table.householdId, table.accountId],
      foreignColumns: [mortgageTerms.householdId, mortgageTerms.accountId],
    }),
    moneyCheck('mortgage_prepayments_amount_format', table.amount),
    positiveCheck('mortgage_prepayments_amount_positive', table.amount),
    dateCheck('mortgage_prepayments_date_format', table.date),
    check(
      'mortgage_prepayments_note_length',
      sql`${table.note} IS NULL OR length(${table.note}) <= 200`,
    ),
    index('mortgage_prepayments_account_date_idx').on(
      table.householdId,
      table.accountId,
      table.date,
    ),
  ],
);

export type MortgageTermsRow = typeof mortgageTerms.$inferSelect;
export type MortgagePrepaymentRow = typeof mortgagePrepayments.$inferSelect;
