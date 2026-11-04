import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApiClient } from '@studious/api';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { testDatabase } from './database.js';
import { budgetXlsx } from './fixtures/budget.js';
import { budgetImportRows, expenses, income } from '../src/models/schema.js';

let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof buildApp>;
let api: ReturnType<typeof createApiClient>;
beforeAll(async () => {
  database = await testDatabase();
  app = buildApp(database, false);
  api = createApiClient(await app.listen({ host: '127.0.0.1', port: 0 }));
});
afterAll(async () => {
  await app?.close();
  await database?.close();
});
const file = (options?: Parameters<typeof budgetXlsx>[0]) =>
  new Blob([new Uint8Array(budgetXlsx(options))]);

it('previews without writes, preserves refunds/dates and deliberate repeated rows, rounds with warnings', async () => {
  const home = await api.createHousehold('Budget test', 'CAD');
  const preview = await api.previewBudget(home.id, file(), 'Budget - 2024.xlsx', 'CAD');
  expect(preview.rows).toHaveLength(6);
  expect(preview.issues).toEqual([]);
  expect(preview.totals).toEqual([
    { sheet: 'Expenses', amount: '215.65', count: 4 },
    { sheet: 'Income', amount: '510.00', count: 2 },
  ]);
  expect(preview.rows[3]?.amount).toBe('22.01');
  expect(preview.rows[0]?.key).not.toBe(preview.rows[1]?.key);
  expect(preview.warnings).toHaveLength(2);
  expect(preview.warnings.join(' ')).toContain('2023-12-30');
  expect(await api.members(home.id)).toEqual([]);
  expect((await api.expenses(home.id, '2024-07')).items).toEqual([]);
  expect((await api.income(home.id, '2024-07')).items).toEqual([]);

  const alex = await api.addMember(home.id, 'Existing Alex');
  const result = await api.importBudget(
    home.id,
    file(),
    'Budget - 2024.xlsx',
    'CAD',
    preview.sha256,
    { Alex: alex.id, Sam: 'CREATE' },
  );
  expect(result).toEqual({ expenses: 4, income: 2, duplicates: 0 });
  expect(await api.members(home.id)).toHaveLength(2);
  expect((await api.expenses(home.id, '2024-07')).totals).toEqual([
    { currency: 'CAD', amount: '215.65' },
  ]);
  expect(
    (await api.expenses(home.id, '2024-07')).items.find((row) => row.name === 'Market')?.memberId,
  ).toBe(alex.id);
  expect((await api.income(home.id, '2023-12')).totals).toEqual([
    { currency: 'CAD', amount: '10.00' },
  ]);
  const overview = await api.overview(home.id, 12, '2024-12-31');
  expect(overview.income).toContainEqual(
    expect.objectContaining({ month: '2024-07', amount: '500.00' }),
  );
  expect(overview.expenses).toContainEqual(expect.objectContaining({ amount: '-6.56' }));

  const again = await api.previewBudget(home.id, file(), 'Renamed.xlsx', 'CAD');
  expect(again.rows.every((row) => row.duplicate)).toBe(true);
  expect(
    await api.importBudget(home.id, file(), 'Renamed.xlsx', 'CAD', again.sha256, {
      Alex: alex.id,
      Sam: 'CREATE',
    }),
  ).toEqual({ expenses: 0, income: 0, duplicates: 6 });
  const changed = file({ extra: true });
  const changedPreview = await api.previewBudget(home.id, changed, 'Next.xlsx', 'CAD');
  expect(
    await api.importBudget(home.id, changed, 'Next.xlsx', 'CAD', changedPreview.sha256, {
      Alex: alex.id,
      Sam: 'CREATE',
    }),
  ).toEqual({ expenses: 1, income: 0, duplicates: 6 });
  const imported = (await api.expenses(home.id, '2024-07')).items[0]!;
  await api.archiveExpense(home.id, imported.id);
  expect(
    (await api.previewBudget(home.id, changed, 'Next.xlsx', 'CAD')).rows.every(
      (row) => row.duplicate,
    ),
  ).toBe(true);
  expect(await api.accounts(home.id)).toEqual([]);
}, 30000);

it('blocks invalid rows, stale file hashes and foreign member mappings without partial writes', async () => {
  const home = await api.createHousehold('Invalid budget', 'CAD');
  const broken = file({ invalidDate: true });
  const preview = await api.previewBudget(home.id, broken, 'Budget.xlsx', 'CAD');
  expect(preview.issues).toHaveLength(1);
  expect(preview.issues[0]).toMatchObject({ sheet: 'Expenses', row: 2 });
  await expect(
    api.importBudget(home.id, broken, 'Budget.xlsx', 'CAD', preview.sha256, {
      Alex: 'CREATE',
      Sam: 'CREATE',
    }),
  ).rejects.toMatchObject({ status: 422 });
  const good = await api.previewBudget(home.id, file(), 'Budget.xlsx', 'CAD');
  await expect(
    api.importBudget(home.id, file({ extra: true }), 'Budget.xlsx', 'CAD', good.sha256, {
      Alex: 'CREATE',
      Sam: 'CREATE',
    }),
  ).rejects.toMatchObject({ status: 422 });
  // Alex would be created first; Sam's foreign mapping must roll back/prevent every write.
  await expect(
    api.importBudget(home.id, file(), 'Budget.xlsx', 'CAD', good.sha256, {
      Alex: 'CREATE',
      Sam: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    api.importBudget(home.id, file(), 'Budget.xlsx', 'CAD', good.sha256, { Alex: 'CREATE' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await api.members(home.id)).toEqual([]);
  expect(await api.expenseCategories(home.id)).toEqual([]);
  expect(
    await database.db
      .select()
      .from(budgetImportRows)
      .where(eq(budgetImportRows.householdId, home.id)),
  ).toEqual([]);
  expect(
    (await api.previewBudget(home.id, file({ negativeIncome: true }), 'Budget.xlsx', 'CAD'))
      .issues[0],
  ).toMatchObject({ sheet: 'Income', row: 2 });
  await expect(
    api.previewBudget(home.id, file({ missingHeader: true }), 'Budget.xlsx', 'CAD'),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    api.previewBudget(home.id, new Blob(['not excel']), 'Budget.xlsx', 'CAD'),
  ).rejects.toMatchObject({ status: 422 });
  await expect(api.previewBudget(randomUUID(), file(), 'Budget.xlsx', 'CAD')).rejects.toMatchObject(
    { status: 404 },
  );
}, 30000);

it('serialises concurrent imports and deduplicates per household, never globally', async () => {
  const home = await api.createHousehold('Concurrent', 'CAD');
  const preview = await api.previewBudget(home.id, file(), 'Budget.xlsx', 'CAD');
  const results = await Promise.all(
    [0, 1].map(() =>
      api.importBudget(home.id, file(), 'Budget.xlsx', 'CAD', preview.sha256, {
        Alex: null,
        Sam: null,
      }),
    ),
  );
  expect(results.map((result) => result.expenses).sort()).toEqual([0, 4]);
  const other = await api.createHousehold('Separate', 'CAD');
  expect(
    (await api.previewBudget(other.id, file(), 'Budget.xlsx', 'CAD')).rows.some(
      (row) => row.duplicate,
    ),
  ).toBe(false);
  expect(
    await database.db.select().from(expenses).where(eq(expenses.householdId, home.id)),
  ).toHaveLength(4);
  expect(
    await database.db.select().from(income).where(eq(income.householdId, home.id)),
  ).toHaveLength(2);
}, 30000);

it('rolls back expenses, members, categories and provenance if a later income insert fails', async () => {
  const home = await api.createHousehold('Rollback budget', 'CAD');
  const preview = await api.previewBudget(home.id, file(), 'Budget.xlsx', 'CAD');
  await database.driver.query(
    `CREATE TRIGGER reject_budget_income BEFORE INSERT ON income WHEN NEW.household_id = '${home.id}' BEGIN SELECT RAISE(ABORT, 'Test import failure'); END`,
    [],
    'run',
  );
  try {
    await expect(
      api.importBudget(home.id, file(), 'Budget.xlsx', 'CAD', preview.sha256, {
        Alex: 'CREATE',
        Sam: 'CREATE',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await api.members(home.id)).toEqual([]);
    expect(await api.expenseCategories(home.id)).toEqual([]);
    expect((await api.expenses(home.id, '2024-07')).items).toEqual([]);
    expect(
      await database.db
        .select()
        .from(budgetImportRows)
        .where(eq(budgetImportRows.householdId, home.id)),
    ).toEqual([]);
  } finally {
    await database.driver.query('DROP TRIGGER reject_budget_income', [], 'run');
  }
  expect(
    await api.importBudget(home.id, file(), 'Budget.xlsx', 'CAD', preview.sha256, {
      Alex: 'CREATE',
      Sam: 'CREATE',
    }),
  ).toEqual({ expenses: 4, income: 2, duplicates: 0 });
}, 30000);
