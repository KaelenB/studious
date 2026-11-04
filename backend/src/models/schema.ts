import { sql } from 'drizzle-orm';
import {
  accountTypes,
  balanceSources,
  type StatementInvestment,
  type StatementPreview,
} from '@studious/api';
import {
  check,
  customType,
  integer,
  jsonb,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const accountType = pgEnum('account_type', accountTypes);
export const balanceSource = pgEnum('balance_source', balanceSources);

export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    defaultCurrency: varchar('default_currency', { length: 3 }).notNull().default('CAD'),
    ...timestamps(),
  },
  (table) => [
    check('households_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('households_currency_format', sql`${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    name: varchar('name', { length: 200 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('members_household_id_id_unique').on(table.householdId, table.id),
    check('members_name_not_blank', sql`length(trim(${table.name})) > 0`),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    memberId: uuid('member_id'),
    name: varchar('name', { length: 200 }).notNull(),
    type: accountType('type').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CAD'),
    balanceSource: balanceSource('balance_source').notNull().default('MANUAL'),
    ...timestamps(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('accounts_household_id_id_unique').on(table.householdId, table.id),
    foreignKey({
      name: 'accounts_member_household_fk',
      columns: [table.householdId, table.memberId],
      foreignColumns: [members.householdId, members.id],
    }),
    check('accounts_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('accounts_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    accountId: uuid('account_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    source: balanceSource('source').notNull().default('MANUAL'),
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
  Partial<Pick<Account, 'memberId'>>;
export type AccountUpdate = Partial<Pick<Account, 'name' | 'memberId'>>;
export type NewBalanceSnapshot = Pick<BalanceSnapshot, 'amount' | 'asOf'>;

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    name: varchar('name', { length: 200 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('expense_categories_household_id_id_unique').on(table.householdId, table.id),
    unique('expense_categories_household_name_unique').on(table.householdId, table.name),
    check('expense_categories_name_not_blank', sql`length(trim(${table.name})) > 0`),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    memberId: uuid('member_id'),
    categoryId: uuid('category_id'),
    name: varchar('name', { length: 200 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CAD'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    ...timestamps(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    check('expenses_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('expenses_amount_positive', sql`${table.amount} > 0`),
    check('expenses_currency_format', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    index('expenses_household_date_idx').on(table.householdId, table.startDate, table.id),
  ],
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Expense = typeof expenses.$inferSelect;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const statementArchives = pgTable(
  'statement_archives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id').notNull(),
    accountId: uuid('account_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    filename: varchar('filename', { length: 200 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    statementDate: date('statement_date', { mode: 'string' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    byteLength: integer('byte_length').notNull(),
    pdf: bytea('pdf').notNull(),
    investments: jsonb('investments').$type<StatementInvestment[]>(),
    provider: varchar('provider', { length: 20 }).notNull().default('SUNLIFE'),
    questrade: jsonb('questrade').$type<NonNullable<StatementPreview['questrade']>>(),
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
      sql`${table.byteLength} = octet_length(${table.pdf}) AND ${table.byteLength} > 0 AND ${table.byteLength} <= 10485760`,
    ),
    index('statement_archives_account_created_idx').on(
      table.householdId,
      table.accountId,
      table.createdAt,
    ),
  ],
);
