import {
  createApiClient,
  ApiError,
  expenseBody,
  expenseUpdateBody,
  expenseQuery,
} from '@studious/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testDatabase } from './database.js';
import { expenses } from '../src/models/schema.js';
import { eq } from 'drizzle-orm';
type Injected = string | { method: 'POST' | 'PATCH'; url: string; payload: object };

describe('distributed client over HTTP', () => {
  let database: Awaited<ReturnType<typeof testDatabase>> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let api: ReturnType<typeof createApiClient>;
  let inject: (request: Injected) => Promise<number>;

  beforeAll(async () => {
    database = await testDatabase();
    const fastify = buildApp(database, false);
    app = fastify;
    api = createApiClient(await fastify.listen({ host: '127.0.0.1', port: 0 }));
    inject = async (request) => (await fastify.inject(request)).statusCode;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
  }, 30000);

  it('distributes a client compatible with every real API operation', async () => {
    expect(await api.health()).toEqual({ status: 'ok', database: 'ok' });
    const household = await api.createHousehold('SDK household', 'CAD');
    expect(await api.household(household.id)).toEqual(household);
    const member = await api.addMember(household.id, 'Alex');
    expect(await api.members(household.id)).toEqual([member]);
    const account = await api.addAccount(household.id, {
      name: 'Savings',
      type: 'SAVINGS',
      memberId: member.id,
    });
    expect(account).toMatchObject({ currency: 'CAD', balanceSource: 'MANUAL' });
    expect(await api.accounts(household.id)).toEqual([account]);
    const updated = await api.updateAccount(household.id, account.id, { name: 'Emergency fund' });
    expect(updated.name).toBe('Emergency fund');
    const snapshot = await api.addBalance(
      household.id,
      account.id,
      '123456789012.34',
      '2026-01-01T12:00:00-06:00',
    );
    expect(snapshot.amount).toBe('123456789012.34');
    expect(snapshot.asOf).toBe('2026-01-01T18:00:00.000Z');
    expect(await api.balances(household.id, account.id, 1, 0)).toEqual([snapshot]);
    expect(await api.balances(household.id, account.id, 1, 1)).toEqual([]);
    await api.archiveAccount(household.id, account.id);
    expect(await api.accounts(household.id)).toEqual([]);
    await expect(api.balances(household.id, account.id)).rejects.toBeInstanceOf(ApiError);
    await expect(api.balances(household.id, account.id)).rejects.toMatchObject({ status: 404 });
  });

  it('manages mortgage terms and prepayments through the SDK', async () => {
    const home = await api.createHousehold('Mortgage home', 'CAD');
    const account = await api.addAccount(home.id, { name: 'Mortgage', type: 'MORTGAGE' });
    expect(await api.mortgage(home.id, account.id)).toEqual({
      terms: null,
      prepayments: [],
      projection: null,
    });
    const saved = await api.saveMortgageTerms(home.id, account.id, {
      principal: '400000.00',
      annualRate: '4.5',
      amortizationMonths: 300,
      termMonths: 60,
      paymentFrequency: 'ACCELERATED_BIWEEKLY',
      startDate: '2025-03-01',
    });
    expect(saved.terms).toMatchObject({ compounding: 'SEMI_ANNUAL', rateType: 'FIXED' });
    const prepayment = await api.addPrepayment(home.id, account.id, {
      amount: '10000.00',
      date: '2025-12-01',
    });
    expect(prepayment.note).toBeNull();
    const projected = await api.mortgage(home.id, account.id, '2026-01-01');
    expect(projected.prepayments).toEqual([prepayment]);
    expect(projected.projection).toMatchObject({ asOf: '2026-01-01', prepaid: '10000.00' });
    await api.deletePrepayment(home.id, account.id, prepayment.id);
    expect((await api.mortgage(home.id, account.id)).prepayments).toEqual([]);
    expect(() => api.mortgage(home.id, account.id, 'not-a-date')).toThrow();
    await expect(
      api.saveMortgageTerms(home.id, account.id, {
        principal: '400000.00',
        annualRate: '4.5',
        amortizationMonths: 300,
        termMonths: 60,
        startDate: '2025-03-01',
        paymentAmount: '1.00',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('tracks categorized expenses with edits, calendar dates and soft archives through the SDK', async () => {
    const home = await api.createHousehold('Spending home', 'CAD');
    const member = await api.addMember(home.id, 'Alex');
    const category = await api.addExpenseCategory(home.id, ' Groceries ');
    expect(category.name).toBe('Groceries');
    expect(await api.expenseCategories(home.id)).toEqual([category]);
    const expense = await api.addExpense(home.id, {
      name: 'Weekly shop',
      amount: '12.34',
      currency: 'USD',
      startDate: '2026-02-28',
      categoryId: category.id,
      memberId: member.id,
    });
    expect(expense).toMatchObject({
      startDate: '2026-02-28',
      amount: '12.34',
      categoryId: category.id,
    });
    const updated = await api.updateExpense(home.id, expense.id, { name: 'Fresh groceries' });
    expect(updated).toMatchObject({ name: 'Fresh groceries', currency: 'USD' });
    expect(await api.expenses(home.id, '2026-02')).toEqual({
      items: [updated],
      totals: [{ currency: 'USD', amount: '12.34' }],
    });
    expect(await api.expenses(home.id, '2026-03')).toEqual({ items: [], totals: [] });
    const moved = await api.updateExpense(home.id, expense.id, {
      startDate: '2026-03-01',
      amount: '15.00',
      categoryId: null,
      memberId: null,
    });
    expect(moved).toMatchObject({ categoryId: null, memberId: null, currency: 'USD' });
    expect(await api.expenses(home.id, '2026-02')).toEqual({ items: [], totals: [] });
    await api.archiveExpense(home.id, expense.id);
    expect(await api.expenses(home.id, '2026-03')).toEqual({ items: [], totals: [] });
    await expect(
      api.updateExpense(home.id, expense.id, { name: 'Archived' }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.archiveExpense(home.id, expense.id)).rejects.toMatchObject({ status: 404 });
    if (!database) throw new Error('Database was not initialized');
    const [stored] = await database.db.select().from(expenses).where(eq(expenses.id, expense.id));
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });

  it('paginates deterministically while aggregating all monthly expenses with exact per-currency totals', async () => {
    const home = await api.createHousehold('Monthly totals', 'CAD');
    for (let index = 0; index < 22; index++) {
      await api.addExpense(home.id, {
        name: `Expense ${index}`,
        amount: '0.10',
        startDate: '2026-01-31',
      });
    }
    for (let index = 0; index < 2; index++) {
      await api.addExpense(home.id, {
        name: 'Large expense',
        amount: '999999999999.99',
        currency: 'USD',
        startDate: '2026-01-01',
      });
    }
    await api.addExpense(home.id, { name: 'Before', amount: '9.00', startDate: '2025-12-31' });
    await api.addExpense(home.id, { name: 'After', amount: '9.00', startDate: '2026-02-01' });
    const first = await api.expenses(home.id, '2026-01', 20);
    const second = await api.expenses(home.id, '2026-01', 20, 20);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(4);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(24);
    expect(first.items.every((item) => item.startDate === '2026-01-31')).toBe(true);
    expect(first.totals).toEqual([
      { currency: 'CAD', amount: '2.20' },
      { currency: 'USD', amount: '1999999999999.98' },
    ]);
    expect(second.totals).toEqual(first.totals);
  });

  it('enforces expense household ownership on reads, relationships, updates and archives', async () => {
    const home = await api.createHousehold('Owner', 'CAD');
    const other = await api.createHousehold('Other', 'CAD');
    const category = await api.addExpenseCategory(home.id, 'Food');
    const member = await api.addMember(home.id, 'Alex');
    const input = { name: 'Lunch', amount: '10.00', startDate: '2026-01-01' };
    const expense = await api.addExpense(home.id, {
      ...input,
      categoryId: category.id,
      memberId: member.id,
    });
    expect(await api.expenseCategories(other.id)).toEqual([]);
    expect(await api.expenses(other.id, '2026-01')).toEqual({ items: [], totals: [] });
    await expect(
      api.addExpense(other.id, { ...input, categoryId: category.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(api.addExpense(other.id, { ...input, memberId: member.id })).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    await expect(api.updateExpense(other.id, expense.id, { name: 'Wrong' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.archiveExpense(other.id, expense.id)).rejects.toMatchObject({ status: 404 });
    const otherExpense = await api.addExpense(other.id, input);
    await expect(
      api.updateExpense(other.id, otherExpense.id, { categoryId: category.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      api.updateExpense(other.id, otherExpense.id, { memberId: member.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(api.addExpenseCategory(home.id, 'Food')).rejects.toMatchObject({ status: 409 });
    expect((await api.addExpenseCategory(other.id, 'Food')).name).toBe('Food');
    if (!database) throw new Error('Database was not initialized');
    await expect(
      database.db
        .insert(expenses)
        .values({ ...input, householdId: other.id, categoryId: category.id }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(expenses).values({ ...input, householdId: other.id, memberId: member.id }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(expenses).values({ ...input, amount: '-1.00', householdId: home.id }),
    ).rejects.toThrow();
  });

  it('rejects invalid expenses, query bounds and mass assignment on the server', async () => {
    const home = await api.createHousehold('Validation home', 'CAD');
    const base = `/households/${home.id}/expenses`;
    const input = { name: 'Lunch', amount: '1.00', startDate: '2026-01-01' };
    for (const invalid of [
      { amount: '-1.00' },
      { amount: '0.00' },
      { amount: 1.23 },
      { amount: '1.001' },
      { amount: '1000000000000.00' },
      { name: ' ' },
      { currency: 'cad' },
      { startDate: '2026-02-29' },
      { startDate: '2026-04-31' },
      { startDate: '0000-01-01' },
      { startDate: '0999-12-31' },
      { householdId: home.id },
      { recurrenceRuleId: home.id },
      { deletedAt: null },
    ]) {
      expect(await inject({ method: 'POST', url: base, payload: { ...input, ...invalid } })).toBe(
        400,
      );
    }
    const expense = await api.addExpense(home.id, input);
    for (const payload of [
      {},
      { amount: '0.00' },
      { startDate: 'invalid' },
      { householdId: home.id },
    ]) {
      expect(await inject({ method: 'PATCH', url: `${base}/${expense.id}`, payload })).toBe(400);
    }
    for (const query of [
      '',
      '?month=2026-13',
      '?month=2026-01&limit=501',
      '?month=2026-01&offset=-1',
      '?month=2026-01&unknown=true',
    ]) {
      expect(await inject(`${base}${query}`)).toBe(400);
    }
    expect(expenseBody.parse({ ...input, startDate: '2024-02-29' }).startDate).toBe('2024-02-29');
    expect(expenseUpdateBody.safeParse({}).success).toBe(false);
    expect(expenseUpdateBody.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(expenseQuery.safeParse({ month: '0000-01' }).success).toBe(false);
  });
});
