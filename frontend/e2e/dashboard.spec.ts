import { test, expect } from '@playwright/test';
import { buildApp } from '../../backend/src/app';
import { openNodeDatabase } from '../../backend/src/db/node';
import { sunLifeInvestmentPdf } from '../../backend/test/fixtures/sunlife';
import { readFile } from 'node:fs/promises';
import { questradeXlsx } from '../../backend/test/fixtures/questrade';
import { createApiClient } from '@studious/api';
import { budgetXlsx } from '../../backend/test/fixtures/budget';

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

test('previews historical budgets, maps members, imports refunds and income, and prevents reimports', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Historical household', 'CAD');
  const alex = await api.addMember(home.id, 'Alex');
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const importer = page.getByRole('region', { name: 'Historical budget import' });
  const upload = (invalid = false) =>
    importer.getByLabel('Budget workbook (XLSX)').setInputFiles({
      name: 'Budget - 2024.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: budgetXlsx({ invalidDate: invalid }),
    });
  await upload();
  expect(
    await importer
      .locator('input')
      .evaluateAll((fields) =>
        fields
          .filter((field) => !field.checkValidity())
          .map((field) => ({ id: field.id, value: field.value, message: field.validationMessage })),
      ),
  ).toEqual([]);
  await importer.getByRole('button', { name: 'Preview workbook' }).click();
  await expect(importer.getByLabel('Budget workbook review')).toContainText(
    '6 valid rows; 0 already imported',
  );
  await expect(importer).toContainText('215.65');
  await expect(importer).toContainText('22.012');
  await expect(importer).toContainText('2023-12-30');
  await expect(importer.getByLabel('Alex', { exact: true })).toHaveValue(alex.id);
  expect((await api.expenses(home.id, '2024-07')).items).toEqual([]);
  expect((await api.income(home.id, '2024-07')).items).toEqual([]);
  await expect(importer.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
  await importer.getByLabel(/I reviewed the dates/).check();
  await importer.getByLabel('Sam', { exact: true }).selectOption('SHARED');
  await expect(importer.getByLabel(/I reviewed the dates/)).not.toBeChecked();
  await importer.getByLabel('Sam', { exact: true }).selectOption('CREATE');
  await importer.getByLabel(/I reviewed the dates/).check();
  await importer.screenshot({ path: testInfo.outputPath('historical-import.png') });
  await importer.getByRole('button', { name: 'Confirm import' }).click();
  await expect(importer.getByRole('alert')).toContainText(
    'Imported 4 expenses and 2 income entries',
  );
  await expect(page.locator('.member-chip')).toHaveCount(2);
  const expenses = page.getByRole('region', { name: 'Household expenses' });
  await expenses.getByLabel('Expense month', { exact: true }).fill('2024-07');
  await expenses.getByRole('button', { name: 'Show month', exact: true }).click();
  await expect(expenses.getByLabel('Monthly expense totals')).toContainText('215.65');
  await expect(expenses.getByRole('row').filter({ hasText: 'Refund' })).toContainText('-CAD');
  await expenses.getByRole('button', { name: 'Edit expense Refund', exact: true }).click();
  await expenses.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(expenses.getByRole('alert')).toContainText('Expense saved.');

  const income = page.getByRole('region', { name: 'Household income' });
  await income.getByLabel('Income month', { exact: true }).fill('2024-07');
  await income.getByRole('button', { name: 'Show month', exact: true }).click();
  await expect(income.getByLabel('Monthly income totals')).toContainText('500.00');
  await expect(income.getByRole('row').filter({ hasText: 'Pay' })).toContainText('Sam');
  await income.getByRole('button', { name: '+ Add income', exact: true }).click();
  await income.getByLabel('Income name', { exact: true }).fill('Extra receipt');
  await income.getByLabel('Income amount', { exact: true }).fill('12.34');
  await income.getByLabel('Income date', { exact: true }).fill('2024-07-04');
  await income.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(income.getByLabel('Monthly income totals')).toContainText('512.34');
  await income.getByRole('button', { name: 'Edit income Extra receipt', exact: true }).click();
  await income.getByLabel('Income amount', { exact: true }).fill('15.00');
  await income.getByRole('button', { name: 'Save income', exact: true }).click();
  await expect(income.getByLabel('Monthly income totals')).toContainText('515.00');
  await income.getByRole('button', { name: 'Archive income Extra receipt', exact: true }).click();
  await income.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect(income.getByLabel('Monthly income totals')).toContainText('500.00');

  const overview = page.getByRole('region', { name: 'Household trends' });
  await overview.getByLabel('History through', { exact: true }).fill('2026-11-04');
  await overview.getByRole('button', { name: 'Apply date', exact: true }).click();
  await overview.getByRole('button', { name: '36M', exact: true }).click();
  const cashflow = overview.getByRole('slider', { name: /Household income and expenses by month/ });
  await cashflow.focus();
  await cashflow.press('Home');
  // The source's earlier-year date is preserved rather than rewritten from the filename.
  await overview.getByText('View monthly cash flow', { exact: true }).click();
  await expect(overview.getByRole('row').filter({ hasText: 'Jul 2024' })).toContainText('284.35');
  await overview.getByText('View monthly cash flow', { exact: true }).click();
  await overview.screenshot({ path: testInfo.outputPath('historical-cashflow.png') });

  await importer.getByRole('button', { name: 'Preview workbook' }).click();
  await expect(importer.getByLabel('Budget workbook review')).toContainText('6 already imported');
  await importer.getByLabel(/I reviewed the dates/).check();
  await expect(importer.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
  await upload(true);
  await importer.getByRole('button', { name: 'Preview workbook' }).click();
  await expect(importer.getByRole('alert').filter({ hasText: 'Fix all' })).toContainText(
    'Expenses row 2',
  );
  await importer.getByLabel(/I reviewed the dates/).check();
  await expect(importer.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('overview combines household history, separates currencies and refreshes charts after expenses', async ({
  page,
}, testInfo) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const home = await api.createHousehold('Together household', 'CAD');
  const alex = await api.addMember(home.id, 'Alex');
  const sam = await api.addMember(home.id, 'Sam');
  const now = new Date();
  const date = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString();
  const month = (offset: number) => date(offset).slice(0, 7);
  const plans = [
    {
      name: 'Alex TFSA',
      type: 'INVESTMENT',
      subtype: 'TFSA',
      memberId: alex.id,
      before: '1000.00',
      after: '1200.00',
    },
    {
      name: 'Sam DCPP',
      type: 'INVESTMENT',
      subtype: 'DCPP',
      memberId: sam.id,
      before: '2000.00',
      after: '2300.00',
    },
    { name: 'Shared savings', type: 'SAVINGS', before: '500.00', after: '600.00' },
    { name: 'Shared loan', type: 'LOAN', before: '100.00', after: '80.00' },
    { name: 'USD savings', type: 'SAVINGS', currency: 'USD', before: '50.00', after: '60.00' },
  ] as const;
  for (const { before, after, ...input } of plans) {
    const account = await api.addAccount(home.id, input);
    await api.addBalance(home.id, account.id, before, date(-12));
    await api.addBalance(home.id, account.id, after, date(0));
  }
  const food = await api.addExpenseCategory(home.id, 'Groceries');
  for (const input of [
    {
      name: 'Alex groceries',
      amount: '10.10',
      categoryId: food.id,
      memberId: alex.id,
      startDate: `${month(0)}-01`,
    },
    {
      name: 'Sam groceries',
      amount: '20.20',
      categoryId: food.id,
      memberId: sam.id,
      startDate: `${month(0)}-01`,
    },
    { name: 'Prior spending', amount: '50.00', startDate: `${month(-1)}-01` },
    { name: 'USD spending', amount: '99.00', currency: 'USD', startDate: `${month(0)}-01` },
  ])
    await api.addExpense(home.id, input);
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  const net = overview.getByRole('slider', { name: /Household net worth by month/ });
  await overview.getByLabel('Annual investment growth (%)', { exact: true }).fill('0');
  await overview.getByRole('button', { name: 'Apply investment assumptions' }).click();
  const lastRecorded = async () => {
    await net.press('End');
    for (let index = 0; index < 12; index++) await net.press('ArrowLeft');
  };
  await net.focus();
  await lastRecorded();
  await expect(net).toHaveAttribute('aria-valuetext', /Household net worth CAD\s4,020\.00/);
  await expect(overview.locator('.kpi').first()).toContainText('+CAD 620.00');
  await net.press('End');
  await expect(net).toHaveAttribute(
    'aria-valuetext',
    /projected.*Projected net worth CAD\s4,020\.00/,
  );
  await overview.getByLabel('Projection basis').selectOption('manual');
  await overview.getByLabel('Monthly net-worth change (CAD)', { exact: true }).fill('10.00');
  await overview.getByRole('button', { name: 'Apply assumption' }).click();
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s4,140\.00/);
  await overview.getByLabel('Project ahead', { exact: true }).selectOption('24');
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s4,260\.00/);
  await overview.getByLabel('Monthly net-worth change (CAD)', { exact: true }).fill('-10.00');
  await overview.getByRole('button', { name: 'Apply assumption' }).click();
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s3,780\.00/);
  await overview.getByText('View projected values', { exact: true }).click();
  await expect(
    overview
      .locator('.chart-data')
      .filter({ hasText: 'View projected values' })
      .locator('tbody tr'),
  ).toHaveCount(24);
  await overview.getByText('View projected values', { exact: true }).click();
  await overview.getByLabel('Project ahead', { exact: true }).selectOption('12');
  await overview.getByLabel('Projection basis').selectOption('automatic');
  await net.press('Home');
  await expect(net).toHaveAttribute('aria-valuetext', /Household net worth CAD\s3,400\.00/);
  await overview.getByRole('button', { name: 'Debts', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Debts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await overview.getByRole('button', { name: 'Debts', exact: true }).click();
  const investments = overview.getByRole('slider', { name: /Household investments by month/ });
  await investments.focus();
  await investments.press('End');
  for (let index = 0; index < 12; index++) await investments.press('ArrowLeft');
  await expect(investments).toHaveAttribute('aria-valuetext', /Investments CAD\s3,500\.00/);
  const allocation = overview.getByRole('img', { name: /Household asset allocation/ });
  await expect(allocation).toHaveAttribute('aria-label', /TFSA CAD\s1,200\.00/);
  await expect(allocation).toHaveAttribute('aria-label', /DCPP CAD\s2,300\.00/);
  const spending = overview.getByRole('slider', { name: /Household spending by month/ });
  await spending.focus();
  await spending.press('End');
  await expect(spending).toHaveAttribute('aria-valuetext', /Recorded spending CAD\s30\.30/);
  const owners = overview.getByRole('slider', { name: /Net worth by household member/ });
  await owners.focus();
  await owners.press('End');
  await expect(owners).toHaveAttribute(
    'aria-valuetext',
    /Shared household: Net worth CAD\s520\.00/,
  );
  await overview.getByRole('button', { name: '6M', exact: true }).click();
  await expect(net).toHaveAttribute('aria-valuemax', '17');
  await overview.getByRole('button', { name: '24M', exact: true }).click();
  await expect(net).toHaveAttribute('aria-valuemax', '35');
  await overview.getByRole('button', { name: '12M', exact: true }).click();
  await overview.getByLabel('Chart currency').selectOption('USD');
  await net.focus();
  await lastRecorded();
  await expect(net).toHaveAttribute('aria-valuetext', /Household net worth USD\s60\.00/);
  await spending.focus();
  await spending.press('End');
  await expect(spending).toHaveAttribute('aria-valuetext', /Recorded spending USD\s99\.00/);
  await overview.getByLabel('Chart currency').selectOption('');

  const expenses = page.getByRole('region', { name: 'Household expenses' });
  await expenses.getByRole('button', { name: '+ Add expense' }).click();
  await expenses.getByLabel('Expense name', { exact: true }).fill('Shared bus fare');
  await expenses.getByLabel('Expense amount', { exact: true }).fill('5.00');
  await expenses.getByLabel('Expense date', { exact: true }).fill(`${month(0)}-01`);
  await expenses.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(expenses.getByRole('alert')).toContainText('Expense saved.');
  await expect(spending).toBeVisible();
  await spending.focus();
  await spending.press('End');
  await expect(spending).toHaveAttribute('aria-valuetext', /Recorded spending CAD\s35\.30/);
  await spending.evaluate((element) => (element as HTMLElement).blur());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await overview.screenshot({ path: testInfo.outputPath('overview.png') });

  await page.getByRole('button', { name: /Shared loan.*80\.00/ }).click();
  await page.getByLabel('Balance (CAD)', { exact: true }).fill('6000.00');
  await page.getByLabel('Observed at (local time)').fill(`${month(0)}-01T12:00`);
  await page.getByRole('button', { name: 'Record balance', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Balance recorded.' })).toBeVisible();
  await net.focus();
  await lastRecorded();
  await expect(net).toHaveAttribute('aria-valuetext', /Household net worth -CAD\s1,900\.00/);
  await expect(net.locator('.zero-line')).toHaveCount(1);

  await page.route('**/overview?*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'History temporarily unavailable' }),
    }),
  );
  await page.reload();
  await expect(overview.getByRole('alert')).toContainText('History temporarily unavailable');
  await page.unroute('**/overview?*');
  await overview.getByRole('button', { name: 'Retry charts' }).click();
  await expect(net).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows isolated per-account history, trends, projections and refreshes after balance entry', async ({
  page,
}, testInfo) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Account insights', 'CAD');
  const date = new Date();
  const earlier = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 12, 1),
  ).toISOString();
  const cash = await api.addAccount(home.id, { name: 'Insight savings', type: 'SAVINGS' });
  const investment = await api.addAccount(home.id, {
    name: 'Insight TFSA',
    type: 'INVESTMENT',
    subtype: 'TFSA',
  });
  for (const account of [cash, investment]) {
    await api.addBalance(home.id, account.id, '1000.00', earlier);
    await api.addBalance(
      home.id,
      account.id,
      '1200.00',
      `${date.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
  }
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  await page.getByRole('button', { name: /Insight savings.*1,200/ }).click();
  const insights = page.getByRole('region', { name: 'Account overview', exact: true });
  await expect(insights).toContainText('+CAD 200.00');
  const plot = insights.getByRole('slider');
  await plot.focus();
  await plot.press('Home');
  await expect(plot).toHaveAttribute('aria-valuetext', /Recorded balance CAD\s1,000\.00/);
  await insights.getByLabel('Account monthly balance change (CAD)').fill('10.00');
  await insights.getByRole('button', { name: 'Apply account assumptions' }).click();
  await plot.focus();
  await plot.press('End');
  await expect(plot).toHaveAttribute('aria-valuetext', /Projected balance CAD\s1,320\.00/);
  await insights.getByLabel('Account projection horizon').selectOption('24');
  await plot.focus();
  await plot.press('End');
  await expect(plot).toHaveAttribute('aria-valuetext', /Projected balance CAD\s1,440\.00/);
  await page.getByLabel('Balance (CAD)', { exact: true }).fill('1300.00');
  await page.getByRole('button', { name: 'Record balance', exact: true }).click();
  await expect(insights.locator('.kpi').first()).toContainText('1,300.00');
  await page.getByRole('button', { name: /Insight TFSA.*1,200/ }).click();
  await insights.getByLabel('Account annual growth (%)').fill('0');
  await insights.getByLabel('Account monthly contribution (CAD)').fill('100.00');
  await insights.getByRole('button', { name: 'Apply account assumptions' }).click();
  await plot.focus();
  await plot.press('End');
  await expect(plot).toHaveAttribute('aria-valuetext', /Projected balance CAD\s2,400\.00/);
  await page.route('**/investment-market?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('accountId')).toBe(investment.id);
    return route.fulfill({
      json: {
        source: 'Yahoo Finance (unofficial public API)',
        fetchedAt: new Date().toISOString(),
        asOf: new Date().toISOString().slice(0, 10),
        currency: 'CAD',
        annualReturn: 10,
        coveragePercent: 100,
        holdings: [],
      },
    });
  });
  await insights.getByRole('button', { name: 'Load account market projection' }).click();
  await expect(insights).toContainText('100.0% account coverage');
  await insights.screenshot({ path: testInfo.outputPath('account-overview.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.route('**/overview?*', (route) =>
    route.fulfill({ status: 500, json: { error: 'Account trends unavailable' } }),
  );
  await insights.getByLabel('Account history through').fill('2026-10-31');
  await insights.getByRole('button', { name: 'Apply account date' }).click();
  await expect(insights.getByRole('alert')).toContainText('Account trends unavailable');
  await page.unroute('**/overview?*');
  await insights.getByRole('button', { name: 'Retry account trends' }).click();
  await expect(insights.getByRole('slider')).toBeVisible();
});

test('loads public holding history on request and applies a disclosed market-based projection', async ({
  page,
}, testInfo) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Market forecast', 'CAD');
  const account = await api.addAccount(home.id, {
    name: 'TFSA',
    type: 'INVESTMENT',
    subtype: 'TFSA',
  });
  await api.addBalance(home.id, account.id, '1000.00', new Date().toISOString());
  let requests = 0;
  await page.route('**/investment-market?*', (route) => {
    requests++;
    return route.fulfill({
      json: {
        source: 'Yahoo Finance (unofficial public API)',
        fetchedAt: new Date().toISOString(),
        asOf: new Date().toISOString().slice(0, 10),
        currency: 'CAD',
        annualReturn: 10,
        coveragePercent: 100,
        holdings: [
          {
            accountId: account.id,
            name: 'Synthetic index ETF',
            symbol: 'TEST.TO',
            statementDate: '2026-10-01',
            weightPercent: 100,
            marketName: 'Synthetic index ETF',
            price: 21,
            priceCurrency: 'CAD',
            priceDate: '2026-11-03',
            historyStart: '2021-11-08',
            annualReturn: 10,
            error: null,
          },
        ],
      },
    });
  });
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  const button = overview.getByRole('button', { name: 'Load market-based projection' });
  await expect(button).toBeVisible();
  expect(requests).toBe(0);
  await button.click();
  await expect(overview.getByRole('table', { name: 'Market holdings' })).toContainText('TEST.TO');
  await expect(overview).toContainText('Weighted historical annual growth: 10.00%');
  const investments = overview.getByRole('slider', { name: /Household investments by month/ });
  await investments.focus();
  await investments.press('End');
  await expect(investments).toHaveAttribute(
    'aria-valuetext',
    /Projected investments CAD\s1,100\.00/,
  );
  const net = overview.getByRole('slider', { name: /Household net worth by month/ });
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s1,100\.00/);
  await net.evaluate((element) => (element as HTMLElement).blur());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await overview
    .locator('.chart-card')
    .filter({ hasText: 'Investment balances over time' })
    .screenshot({ path: testInfo.outputPath('market-holdings.png') });
  await overview.getByRole('button', { name: 'Apply investment assumptions' }).click();
  await investments.focus();
  await investments.press('End');
  await expect(investments).toHaveAttribute(
    'aria-valuetext',
    /Projected investments CAD\s1,050\.00/,
  );
  await page.unroute('**/investment-market?*');
  await page.route('**/investment-market?*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Market history temporarily unavailable' },
    }),
  );
  await button.click();
  await expect(
    overview.getByRole('alert').filter({ hasText: 'Market history temporarily unavailable' }),
  ).toBeVisible();
  await expect(button).toBeEnabled();
});

test('extends net worth beyond November when another account has no balance', async ({ page }) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Partial forecast', 'CAD');
  const savings = await api.addAccount(home.id, { name: 'Known savings', type: 'SAVINGS' });
  await api.addBalance(home.id, savings.id, '1000.00', '2026-11-01T00:00:00.000Z');
  const unknown = await api.addAccount(home.id, { name: 'Unobserved mortgage', type: 'MORTGAGE' });
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  await overview.getByLabel('History through').fill('2026-11-04');
  await overview.getByRole('button', { name: 'Apply date' }).click();
  const net = overview.getByRole('slider', { name: /Household net worth by month/ });
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute(
    'aria-valuetext',
    /Nov 2027 \(projected\).*Projected net worth CAD\s1,000\.00/,
  );
  await expect(
    overview.getByRole('alert').filter({ hasText: 'Partial net-worth projection' }),
  ).toContainText('1 CAD account(s)');
  await overview.getByLabel('Project ahead', { exact: true }).selectOption('24');
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Nov 2028 \(projected\)/);
  await overview.getByText('View projected values', { exact: true }).click();
  await expect(
    overview.locator('details').filter({ hasText: 'View projected values' }).locator('tbody tr'),
  ).toHaveCount(24);
  await api.addBalance(home.id, unknown.id, '400.00', '2026-11-01T00:00:00.000Z');
  await page.reload();
  await overview.getByLabel('History through').fill('2026-11-04');
  await overview.getByRole('button', { name: 'Apply date' }).click();
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute(
    'aria-valuetext',
    /Nov 2027 \(projected\).*Projected net worth CAD\s600\.00/,
  );
  await expect(
    overview.getByRole('alert').filter({ hasText: 'Partial net-worth projection' }),
  ).toHaveCount(0);
});

test('projects investment growth and contributions without counting transfers twice in net worth', async ({
  page,
}) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Investment forecast', 'CAD');
  const account = await api.addAccount(home.id, {
    name: 'TFSA',
    type: 'INVESTMENT',
    subtype: 'TFSA',
  });
  await api.addBalance(home.id, account.id, '1000.00', new Date().toISOString());
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  const investments = overview.getByRole('slider', { name: /Household investments by month/ });
  await investments.focus();
  await investments.press('End');
  await expect(investments).toHaveAttribute(
    'aria-valuetext',
    /projected.*Projected investments CAD\s1,050\.00/,
  );
  await overview.getByLabel('Annual investment growth (%)', { exact: true }).fill('0');
  await overview
    .getByLabel('Monthly investment contribution (CAD)', { exact: true })
    .fill('100.00');
  await overview.getByRole('button', { name: 'Apply investment assumptions' }).click();
  await investments.focus();
  await investments.press('End');
  await expect(investments).toHaveAttribute(
    'aria-valuetext',
    /Projected investments CAD\s2,200\.00/,
  );
  const net = overview.getByRole('slider', { name: /Household net worth by month/ });
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s1,000\.00/);
  await overview.getByLabel('Annual investment growth (%)', { exact: true }).fill('12');
  await overview.getByRole('button', { name: 'Apply investment assumptions' }).click();
  await investments.focus();
  await investments.press('End');
  await expect(investments).toHaveAttribute(
    'aria-valuetext',
    /Projected investments CAD\s2,384\.65/,
  );
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s1,184\.65/);
  await overview.getByText('View projected investments', { exact: true }).click();
  await expect(
    overview
      .locator('details')
      .filter({ hasText: 'View projected investments' })
      .locator('tbody tr'),
  ).toHaveCount(12);
});

test('downloads the SQLite database and shows recoverable download failures', async ({ page }) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Database download', 'CAD');
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Download SQLite database' });
  const downloading = page.waitForEvent('download');
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^studious-\d{4}-\d{2}-\d{2}\.sqlite$/);
  const path = await download.path();
  expect((await readFile(path!)).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  await expect(button).toBeEnabled();
  await page.route('**/database/backup', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Backup temporarily unavailable' }),
    }),
  );
  await button.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Database download failed' }),
  ).toContainText('Backup temporarily unavailable');
  await expect(button).toBeEnabled();
});

test('projects household net worth from completed recorded cash flow', async ({ page }) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Cash-flow projection', 'CAD');
  const account = await api.addAccount(home.id, { name: 'Savings', type: 'SAVINGS' });
  const now = new Date();
  await api.addBalance(home.id, account.id, '1000.00', now.toISOString());
  for (const offset of [-3, -2, -1, 0]) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
      .toISOString()
      .slice(0, 10);
    await api.addIncome(home.id, {
      name: 'Receipt',
      amount: offset === 0 ? '9999.00' : '100.00',
      startDate: date,
    });
    await api.addExpense(home.id, { name: 'Spending', amount: '25.00', startDate: date });
  }
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  const net = overview.getByRole('slider', { name: /Household net worth by month/ });
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s1,900\.00/);
  await expect(overview.getByRole('status')).toContainText('3 completed months');
  await overview.getByLabel('Project ahead', { exact: true }).selectOption('60');
  await net.focus();
  await net.press('End');
  await expect(net).toHaveAttribute('aria-valuetext', /Projected net worth CAD\s5,500\.00/);
});

test('visualizations fit their cards at narrow, tablet and desktop widths', async ({
  page,
}, testInfo) => {
  const api = createApiClient('http://127.0.0.1:3101');
  const home = await api.createHousehold('Responsive charts', 'CAD');
  const member = await api.addMember(home.id, 'HouseholdMemberWithAnUnbrokenLongName');
  const today = new Date().toISOString().slice(0, 10);
  for (const subtype of ['TFSA', 'DCPP', 'RRSP'] as const) {
    const account = await api.addAccount(home.id, {
      name: subtype,
      type: 'INVESTMENT',
      subtype,
      memberId: member.id,
    });
    await api.addBalance(home.id, account.id, '1234567.89', `${today}T00:00:00.000Z`);
  }
  const category = await api.addExpenseCategory(
    home.id,
    'HouseholdExpensesWithAnUnbrokenLongCategoryName',
  );
  await api.addExpense(home.id, {
    name: 'Recorded spending',
    categoryId: category.id,
    amount: '123456.78',
    startDate: today,
  });
  await page.addInitScript((id) => localStorage.setItem('studious.householdId', id), home.id);
  await page.goto('/');
  const overview = page.getByRole('region', { name: 'Household trends' });
  await expect(overview.locator('.donut-chart')).toHaveCount(2);
  await overview.getByLabel('Projection basis').selectOption('manual');
  for (const width of [320, 390, 768, 920, 1024, 1280, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await overview.evaluate((section) => {
      const failures: string[] = [];
      for (const card of section.querySelectorAll('.chart-card')) {
        const bounds = card.getBoundingClientRect();
        for (const element of card.querySelectorAll(
          '.time-chart, .chart-frame, .chart-plot, .donut-chart, .donut-legend, .donut-legend li, .forecast-controls, .forecast-controls input, .forecast-controls select',
        )) {
          const rect = element.getBoundingClientRect();
          if (
            rect.left < bounds.left - 1 ||
            rect.right > bounds.right + 1 ||
            element.scrollWidth > element.clientWidth + 1
          )
            failures.push(`${card.querySelector('h3')?.textContent}: ${element.className}`);
        }
      }
      return failures;
    });
    expect(overflow, `Chart overflow at ${width}px`).toEqual([]);
    for (const plot of await overview.getByRole('slider').all()) {
      await plot.focus();
      for (const key of ['Home', 'End', 'ArrowLeft']) {
        await plot.press(key);
        const fits = await plot.evaluate((element) => {
          const tooltip = element.querySelector('.chart-tooltip')!;
          const bounds = tooltip.getBoundingClientRect();
          const card = element.closest('.chart-card')!.getBoundingClientRect();
          return (
            bounds.left >= card.left &&
            bounds.right <= card.right &&
            tooltip.scrollWidth <= tooltip.clientWidth + 1
          );
        });
        expect(fits, `Tooltip overflow at ${width}px after ${key}`).toBe(true);
      }
      await plot.evaluate((element) => (element as HTMLElement).blur());
    }
    if ([390, 1024, 1280].includes(width))
      await overview.screenshot({ path: testInfo.outputPath(`chart-width-${width}.png`) });
  }
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
  await expect(page.getByRole('table', { name: 'Recorded balance snapshots' })).toHaveClass(
    /table/,
  );
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
    page
      .getByRole('region', { name: 'Account details', exact: true })
      .locator(':scope > .section-heading .eyebrow'),
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
  const chart = mortgage.getByRole('slider', { name: /Mortgage projection by year/ });
  await chart.focus();
  await chart.press('Home');
  const tooltip = mortgage.locator('.chart-tooltip');
  await expect(tooltip).toContainText('Start (2024-01-15)');
  await expect(tooltip).toContainText('Balance');
  await expect(tooltip).toContainText('500,000.00');
  await expect(tooltip).toContainText('Home equity');
  await expect(tooltip).toContainText('300,000.00');
  await chart.press('ArrowRight');
  await expect(tooltip).toContainText('End of 2024');
  await expect(chart).toHaveAttribute('aria-valuetext', /End of 2024: Balance CAD/);
  await expect(mortgage.locator('.chart-dot')).toHaveCount(5);
  await mortgage.getByRole('button', { name: 'Interest paid' }).click();
  await expect(mortgage.getByRole('button', { name: 'Interest paid' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await chart.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).not.toContainText('Interest paid');
  await chart.press('End');
  await expect(tooltip).toContainText('End of 2049');
  await expect(mortgage.getByRole('button', { name: 'Without prepayments' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await mortgage.getByLabel('Amount (CAD)').fill('20000.00');
  await mortgage.getByLabel('Date', { exact: true }).fill('2024-06-01');
  await mortgage.getByLabel('Note (optional)').fill('Bonus');
  await mortgage.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(mortgage.getByRole('cell', { name: 'Bonus' })).toBeVisible();
  await expect(mortgage).toContainText('Saved by prepaying');
  await expect(mortgage.getByRole('button', { name: 'Without prepayments' })).toBeVisible();
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
