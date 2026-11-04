import { test, expect } from '@playwright/test';
import { buildApp } from '../../backend/src/app';
import { openNodeDatabase } from '../../backend/src/db/node';
import { sunLifeInvestmentPdf } from '../../backend/test/fixtures/sunlife';
import { readFile } from 'node:fs/promises';
import { questradeXlsx } from '../../backend/test/fixtures/questrade';

let database: ReturnType<typeof openNodeDatabase> | undefined;
let app: ReturnType<typeof buildApp> | undefined;

test.beforeAll(async () => {
  database = openNodeDatabase(':memory:');
  await database.migrate();
  app = buildApp(database, false);
  await app.listen({ host: '127.0.0.1', port: 3101 });
});

test.afterAll(async () => {
  await app?.close();
  await database?.close();
});

test('household, member, account, balance, reload, edit and archive work with the live SQLite API', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Household name')).toHaveClass(/form-control/);
  await expect(page.getByRole('button', { name: 'Create household' })).toHaveClass(/btn-primary/);
  await page.getByLabel('Household name').fill('Browser test home');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page.getByRole('heading', { name: 'Your financial overview.' })).toBeVisible();
  const savedHouseholdId = await page.locator('.household-id').innerText();
  await expect(page.getByText('No accounts yet')).toBeVisible();
  await page.getByLabel('Add household member').fill('Alex');
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(page.locator('.member-chip')).toHaveText('Alex');
  await page.getByRole('button', { name: '+ Add account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Everyday account');
  await page.getByLabel('Account owner').selectOption({ label: 'Alex' });
  expect(
    await page.locator('.form-panel input, .form-panel select').evaluateAll((fields) =>
      fields
        .filter((field) => field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
        .filter((field) => !field.checkValidity())
        .map((field) => ({ id: field.id, value: field.value, message: field.validationMessage })),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Save account' }).click();
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Everyday account', exact: true })).toBeVisible();
  await expect(page.getByText('1 CAD account(s) have no balance')).toBeVisible();
  await page.getByLabel('Balance (CAD)').fill('1234.56');
  await page.getByLabel('Observed at (local time)').fill('2026-01-01T12:00');
  await page.getByRole('button', { name: 'Record balance', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Balance recorded.' })).toBeVisible();
  await expect(page.locator('.net-card .summary-value')).toContainText('1,234.56');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.reload();
  await expect(page.locator('.net-card .summary-value')).toContainText('1,234.56');
  await page.getByRole('button', { name: /Everyday account.*1,234.56/ }).click();
  await expect(page.getByRole('cell', { name: /1,234.56/ })).toBeVisible();
  await expect(page.locator('.detail table')).toHaveClass(/table/);
  await page.getByRole('button', { name: 'Edit account', exact: true }).click();
  await page.getByLabel('Account name', { exact: true }).fill('Renamed savings');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed savings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect(page.getByText('No accounts yet')).toBeVisible();
  await page.getByRole('button', { name: 'Switch household' }).click();
  await expect(page.getByRole('button', { name: 'Create household' })).toBeVisible();
  await page.getByLabel('Household ID', { exact: true }).fill(savedHouseholdId);
  await page.getByRole('button', { name: 'Connect household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your financial overview.' })).toBeVisible();
  await expect(page.getByText('No accounts yet')).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('shows recoverable API failure rather than a successful empty dashboard', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/households', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Database unavailable"}',
    }),
  );
  await page.getByLabel('Household name').fill('Offline test');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page.getByRole('alert')).toContainText('Database unavailable');
  await expect(page.getByRole('alert')).toHaveClass(/alert-danger/);
  await expect(page.getByRole('button', { name: 'Create household' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your financial overview.' })).toHaveCount(0);
});

test('categorizes, records, edits and archives expenses with separate monthly currency totals', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Household name').fill('Expense browser home');
  await page.getByRole('button', { name: 'Create household' }).click();
  const expenses = page.getByRole('region', { name: 'Household expenses' });
  await expect(expenses.getByRole('button', { name: '+ Add expense' })).toBeEnabled();
  await page.getByLabel('Add household member').fill('Alex');
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(page.locator('.member-chip')).toHaveText('Alex');
  await expenses.getByLabel('New expense category').fill('Groceries');
  await expenses.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(expenses.getByRole('alert')).toContainText('Category added.');
  await expenses.getByRole('button', { name: '+ Add expense' }).click();
  await expenses.getByLabel('Expense name', { exact: true }).fill('Market shop');
  await expenses.getByLabel('Expense amount', { exact: true }).fill('12.34');
  await expenses.getByLabel('Expense currency', { exact: true }).fill('USD');
  await expenses.getByLabel('Expense date', { exact: true }).fill('2026-01-31');
  await expenses
    .getByLabel('Expense category', { exact: true })
    .selectOption({ label: 'Groceries' });
  await expenses.getByLabel('Expense member', { exact: true }).selectOption({ label: 'Alex' });
  await expenses.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(expenses.getByRole('alert')).toContainText('Expense saved.');
  const totals = expenses.getByLabel('Monthly expense totals');
  await expect(totals).toContainText('USD 12.34');
  const row = expenses.getByRole('row').filter({ hasText: 'Market shop' });
  await expect(row).toContainText('2026-01-31');
  await expect(row).toContainText('Groceries');
  await expect(row).toContainText('Alex');
  await expenses.getByRole('button', { name: '+ Add expense' }).click();
  await expenses.getByLabel('Expense name', { exact: true }).fill('Bus fare');
  await expenses.getByLabel('Expense amount', { exact: true }).fill('0.10');
  await expenses.getByLabel('Expense date', { exact: true }).fill('2026-01-31');
  await expenses.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(totals).toContainText('CAD 0.10');
  await expect(totals).toContainText('USD 12.34');
  await expenses.getByRole('button', { name: 'Edit expense Market shop', exact: true }).click();
  await expenses.getByLabel('Expense name', { exact: true }).fill('February shop');
  await expenses.getByLabel('Expense amount', { exact: true }).fill('15.67');
  await expenses.getByLabel('Expense date', { exact: true }).fill('2026-02-28');
  await expenses.getByLabel('Expense member', { exact: true }).selectOption('');
  await expenses.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(totals).toContainText('USD 15.67');
  await expect(totals).not.toContainText('CAD');
  await expect(expenses.getByRole('row').filter({ hasText: 'February shop' })).toContainText(
    'Shared household',
  );
  await page.reload();
  await expect(expenses.getByRole('button', { name: 'Show month', exact: true })).toBeEnabled();
  await expenses.getByLabel('Expense month', { exact: true }).fill('2026-02');
  await expenses.getByRole('button', { name: 'Show month', exact: true }).click();
  await expect(totals).toContainText('USD 15.67');
  await expenses
    .getByRole('button', { name: 'Archive expense February shop', exact: true })
    .click();
  await expenses.getByRole('button', { name: 'Keep expense', exact: true }).click();
  await expect(expenses.getByRole('cell', { name: 'February shop', exact: true })).toBeVisible();
  await expenses
    .getByRole('button', { name: 'Archive expense February shop', exact: true })
    .click();
  await expenses.getByRole('button', { name: 'Confirm expense archive', exact: true }).click();
  await expect(expenses.getByText('No expenses for 2026-02.', { exact: true })).toBeVisible();
  await expenses.getByLabel('Expense month', { exact: true }).fill('2026-01');
  await expenses.getByRole('button', { name: 'Show month', exact: true }).click();
  await expect(totals).toContainText('CAD 0.10');
  await expect(expenses.getByRole('cell', { name: 'Bus fare', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('paginates expenses without truncating totals and recovers from failed expense loads', async ({
  page,
}) => {
  const created = await page.request.post('/api/households', { data: { name: 'Expense pages' } });
  expect(created.ok()).toBe(true);
  const home = await created.json();
  for (let index = 0; index < 22; index++) {
    const response = await page.request.post(`/api/households/${home.id}/expenses`, {
      data: { name: `Paged expense ${index}`, amount: '0.10', startDate: '2026-01-01' },
    });
    expect(response.ok()).toBe(true);
  }
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.route('**/api/households/*/expenses?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Expense service unavailable"}',
    }),
  );
  await page.goto('/');
  const expenses = page.getByRole('region', { name: 'Household expenses' });
  await expect(expenses.getByRole('alert')).toContainText('Expense service unavailable');
  await expect(expenses.getByLabel('Monthly expense totals')).toHaveCount(0);
  await page.unroute('**/api/households/*/expenses?*');
  await expenses.getByRole('button', { name: 'Retry expenses', exact: true }).click();
  await expect(expenses.getByRole('alert')).toHaveCount(0);
  await expenses.getByLabel('Expense month', { exact: true }).fill('2026-01');
  await expenses.getByRole('button', { name: 'Show month', exact: true }).click();
  await expect(expenses.locator('tbody tr')).toHaveCount(20);
  await expect(expenses.getByLabel('Monthly expense totals')).toContainText('CAD 2.20');
  await expenses.getByRole('button', { name: 'Next expenses', exact: true }).click();
  await expect(expenses.locator('tbody tr')).toHaveCount(2);
  await expect(expenses.getByLabel('Monthly expense totals')).toContainText('CAD 2.20');
  await expect(expenses.getByRole('button', { name: 'Next expenses', exact: true })).toBeDisabled();
  await expenses.getByRole('button', { name: 'Previous expenses', exact: true }).click();
  await expect(expenses.locator('tbody tr')).toHaveCount(20);
});

test('reviews a dated Questrade XLSX, saves CAD equity and preserves native-currency positions', async ({
  page,
}) => {
  const home = await (
    await page.request.post('/api/households', { data: { name: 'Questrade browser home' } })
  ).json();
  const account = await (
    await page.request.post(`/api/households/${home.id}/accounts`, {
      data: { name: 'Questrade TFSA', type: 'INVESTMENT', subtype: 'TFSA', currency: 'CAD' },
    })
  ).json();
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  await page.getByRole('button', { name: /Questrade TFSA.*No balance yet/ }).click();
  await expect(
    page.getByRole('region', { name: 'Account details', exact: true }).locator('.eyebrow'),
  ).toHaveText('Investment \u00b7 TFSA');
  const imports = page.getByRole('region', { name: 'Investment statement imports' });
  await imports.getByLabel('Investment export (PDF or XLSX)', { exact: true }).setInputFiles({
    name: 'InvestmentSummary.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: questradeXlsx(),
  });
  await expect(imports.getByLabel('Questrade observation date', { exact: true })).toHaveValue('');
  await imports.getByLabel('Questrade observation date', { exact: true }).fill('2026-10-31');
  await imports.getByRole('button', { name: 'Review export', exact: true }).click();
  const review = imports.getByLabel('Statement review');
  await expect(review).toContainText('CAD 117.56');
  await expect(review).toContainText('2026-10-31');
  await expect(review).toContainText('Cash: CAD 2.16 / USD 1.00');
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'USD 10.00',
  );
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    '2.00001',
  );
  await imports
    .getByRole('button', { name: 'Confirm snapshot and archive export', exact: true })
    .click();
  await expect(imports.getByRole('alert')).toContainText(
    'Snapshot saved and original XLSX archived.',
  );
  await expect(page.locator('.net-card .summary-value')).toContainText('117.56');
  const downloaded = page.waitForEvent('download');
  await imports
    .getByRole('button', { name: 'Download InvestmentSummary.xlsx', exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('InvestmentSummary.xlsx');
  const path = await download.path();
  if (!path) throw new Error('Missing workbook download');
  expect(await readFile(path)).toEqual(questradeXlsx());
  await page.reload();
  await page.getByRole('button', { name: /Questrade TFSA.*117.56/ }).click();
  await imports.locator('summary').filter({ hasText: 'Investment details' }).click();
  await expect(imports.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'Example US Stock',
  );
  await expect(imports.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'USD 10.00',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('reviews a Sun Life PDF before saving a snapshot and downloading its original archive', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const created = await page.request.post('/api/households', {
    data: { name: 'PDF browser home' },
  });
  const home = await created.json();
  const createdAccount = await page.request.post(`/api/households/${home.id}/accounts`, {
    data: { name: 'Sun Life retirement', type: 'INVESTMENT', currency: 'CAD' },
  });
  const account = await createdAccount.json();
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  await page.getByRole('button', { name: /Sun Life retirement.*No balance yet/ }).click();
  await page.getByRole('button', { name: 'Edit account', exact: true }).click();
  await page.getByLabel('Investment sub-type', { exact: true }).selectOption('DCPP');
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Sun Life retirement.*Investment \u00b7 DCPP/ }),
  ).toBeVisible();
  const statements = page.getByRole('region', { name: 'Investment statement imports' });
  await statements.getByLabel('Investment export (PDF or XLSX)', { exact: true }).setInputFiles({
    name: 'sunlife.pdf',
    mimeType: 'application/pdf',
    buffer: sunLifeInvestmentPdf(),
  });
  await statements.getByRole('button', { name: 'Review export', exact: true }).click();
  const review = statements.getByLabel('Statement review');
  await expect(review).toContainText('CAD 1,234.56');
  await expect(review).toContainText('2026-09-30');
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'Example Balanced Fund',
  );
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    '10.12345',
  );
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    '12.3456',
  );
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'Example Bond Fund',
  );
  await expect(review.getByRole('table', { name: 'Investment breakdown' })).not.toContainText(
    '60.00%',
  );
  const base = `/api/households/${home.id}/accounts/${account.id}`;
  expect(await (await page.request.get(`${base}/balances`)).json()).toEqual([]);
  expect(await (await page.request.get(`${base}/statements`)).json()).toEqual([]);
  await statements.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(review).toHaveCount(0);
  await statements.getByRole('button', { name: 'Review export', exact: true }).click();
  await expect(review).toBeVisible();
  await statements
    .getByRole('button', { name: 'Confirm snapshot and archive export', exact: true })
    .click();
  await expect(statements.getByRole('alert')).toContainText(
    'Snapshot saved and original PDF archived.',
  );
  await expect(page.locator('.net-card .summary-value')).toContainText('1,234.56');
  await expect(
    page
      .getByRole('region', { name: 'Account details', exact: true })
      .getByRole('cell', { name: 'Manual', exact: true }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await statements.getByRole('button', { name: 'Download sunlife.pdf', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('sunlife.pdf');
  const path = await download.path();
  if (!path) throw new Error('No downloaded PDF');
  expect(await readFile(path)).toEqual(sunLifeInvestmentPdf());
  await page.reload();
  await page.getByRole('button', { name: /Sun Life retirement.*1,234.56/ }).click();
  await expect(
    statements.getByRole('button', { name: 'Download sunlife.pdf', exact: true }),
  ).toBeVisible();
  await statements.locator('summary').filter({ hasText: 'Investment details' }).click();
  await expect(statements.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    '20.50000',
  );
  // Simulate an archive created before investment extraction was available.
  if (!database) throw new Error('Database was not initialized');
  const { statementArchives } = await import('../../backend/src/models/schema');
  const { eq } = await import('drizzle-orm');
  await database.db
    .update(statementArchives)
    .set({ investments: null })
    .where(eq(statementArchives.accountId, account.id));
  await page.reload();
  await page.getByRole('button', { name: /Sun Life retirement.*1,234.56/ }).click();
  await statements.locator('summary').filter({ hasText: 'Investment details' }).click();
  await statements
    .getByRole('button', { name: 'Extract investments from archived export', exact: true })
    .click();
  await expect(statements.getByRole('alert')).toContainText('No new balance snapshot was created.');
  await expect(statements.getByRole('table', { name: 'Investment breakdown' })).toContainText(
    'Example Balanced Fund',
  );
  expect(await (await page.request.get(`${base}/balances`)).json()).toHaveLength(1);
  await statements.getByLabel('Investment export (PDF or XLSX)', { exact: true }).setInputFiles({
    name: 'renamed.pdf',
    mimeType: 'application/pdf',
    buffer: sunLifeInvestmentPdf(),
  });
  await statements.getByRole('button', { name: 'Review export', exact: true }).click();
  await expect(review).toBeVisible();
  await statements
    .getByRole('button', { name: 'Confirm snapshot and archive export', exact: true })
    .click();
  await expect(statements.getByRole('alert')).toContainText('already been imported');
  expect(await (await page.request.get(`${base}/balances`)).json()).toHaveLength(1);
  await statements.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await statements.getByLabel('Investment export (PDF or XLSX)', { exact: true }).setInputFiles({
    name: 'damaged.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nbroken'),
  });
  await statements.getByRole('button', { name: 'Review export', exact: true }).click();
  await expect(statements.getByRole('alert')).toContainText('Cannot read this PDF');
  await expect(review).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('sets up mortgage terms, projects amortization and tracks prepayments', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const home = await (
    await page.request.post('/api/households', { data: { name: 'Mortgage browser home' } })
  ).json();
  await page.request.post(`/api/households/${home.id}/accounts`, {
    data: { name: 'Home mortgage', type: 'MORTGAGE' },
  });
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  await page.getByRole('button', { name: /Home mortgage.*No balance yet/ }).click();
  const mortgage = page.getByRole('region', { name: 'Mortgage', exact: true });
  await expect(mortgage.getByRole('heading', { name: 'Set up mortgage terms' })).toBeVisible();
  await mortgage.getByLabel('Principal (CAD)').fill('500000.00');
  await mortgage.getByLabel('Annual rate (%)').fill('5');
  await mortgage.getByLabel('Start date').fill('2024-01-15');
  await mortgage.getByLabel('Amortization (years)').fill('25');
  await mortgage.getByLabel('Property value (optional)').fill('800000.00');
  await mortgage.getByRole('button', { name: 'Save mortgage terms' }).click();
  await expect(
    mortgage.getByRole('alert').filter({ hasText: 'Mortgage terms saved.' }),
  ).toBeVisible();
  await expect(mortgage.locator('.mortgage-stat').first()).toContainText('Monthly payment');
  await expect(mortgage.locator('.mortgage-stat').first()).toContainText('2,908.02');
  await expect(mortgage).toContainText('Home equity');
  await expect(mortgage.getByRole('img', { name: /Balance declines/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await mortgage.getByLabel('Amount (CAD)').fill('20000.00');
  await mortgage.getByLabel('Date', { exact: true }).fill('2024-06-01');
  await mortgage.getByLabel('Note (optional)').fill('Bonus');
  await mortgage.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(mortgage.getByRole('cell', { name: 'Bonus' })).toBeVisible();
  await expect(mortgage).toContainText('Saved by prepaying');
  await mortgage.getByText('Yearly amortization schedule').click();
  await expect(mortgage.getByRole('cell', { name: '2024', exact: true })).toBeVisible();

  await mortgage.getByRole('button', { name: 'Record projected balance' }).click();
  await expect(
    mortgage.getByRole('alert').filter({ hasText: 'Recorded the projected balance' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Home mortgage.*CAD/ })).toBeVisible();

  await mortgage.getByRole('button', { name: /Remove .* prepayment/ }).click();
  await expect(
    mortgage.getByRole('alert').filter({ hasText: 'Prepayment removed.' }),
  ).toBeVisible();
  await expect(mortgage).not.toContainText('Saved by prepaying');

  await mortgage.getByRole('button', { name: 'Edit terms' }).click();
  await mortgage.getByLabel('Payment frequency').selectOption('ACCELERATED_BIWEEKLY');
  await mortgage.getByRole('button', { name: 'Save mortgage terms' }).click();
  await expect(mortgage).toContainText('Accelerated bi-weekly payment');
  await expect(mortgage).toContainText('1,454.01');
  expect(pageErrors).toEqual([]);
});
