import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApiClient } from '@studious/api';
import { buildApp } from '../src/app.js';
import { testDatabase } from './database.js';

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

it('creates, edits, paginates and archives historical income with full per-currency totals', async () => {
  const home = await api.createHousehold('Receipts', 'CAD');
  const member = await api.addMember(home.id, 'Alex');
  const receipt = await api.addIncome(home.id, {
    name: 'Pay',
    amount: '123.45',
    startDate: '2024-02-29',
    memberId: member.id,
  });
  await api.addIncome(home.id, { name: 'Receipt', amount: '0.10', startDate: '2024-02-01' });
  await api.addIncome(home.id, {
    name: 'USD receipt',
    amount: '20.00',
    currency: 'USD',
    startDate: '2024-02-01',
  });
  const page = await api.income(home.id, '2024-02', 1);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.id).toBe(receipt.id);
  expect(page.totals).toEqual([
    { currency: 'CAD', amount: '123.55' },
    { currency: 'USD', amount: '20.00' },
  ]);
  expect((await api.income(home.id, '2024-02', 1, 1)).items[0]?.id).not.toBe(receipt.id);
  expect(
    (
      await api.updateIncome(home.id, receipt.id, {
        amount: '150.00',
        startDate: '2024-03-01',
        memberId: null,
      })
    ).memberId,
  ).toBeNull();
  expect((await api.income(home.id, '2024-03')).totals).toEqual([
    { currency: 'CAD', amount: '150.00' },
  ]);
  await api.archiveIncome(home.id, receipt.id);
  expect((await api.income(home.id, '2024-03')).items).toEqual([]);
  await expect(api.updateIncome(home.id, receipt.id, { name: 'No' })).rejects.toMatchObject({
    status: 404,
  });
  await expect(api.archiveIncome(home.id, receipt.id)).rejects.toMatchObject({ status: 404 });
});

it('enforces income household ownership, date/money validation and refund totals', async () => {
  const home = await api.createHousehold('Validation', 'CAD');
  const other = await api.createHousehold('Other', 'CAD');
  const member = await api.addMember(other.id, 'Foreign');
  const input = { name: 'Income', amount: '20.00', startDate: '2024-01-01' };
  await expect(api.addIncome(home.id, { ...input, memberId: member.id })).rejects.toMatchObject({
    status: 409,
  });
  const receipt = await api.addIncome(home.id, input);
  const usd = await api.addIncome(home.id, { ...input, currency: 'USD' });
  expect((await api.updateIncome(home.id, usd.id, { name: 'Renamed USD' })).currency).toBe('USD');
  await expect(api.updateIncome(other.id, receipt.id, { name: 'Wrong' })).rejects.toMatchObject({
    status: 404,
  });
  await expect(api.archiveIncome(other.id, receipt.id)).rejects.toMatchObject({ status: 404 });
  await expect(api.income(randomUUID(), '2024-01')).rejects.toMatchObject({ status: 404 });
  for (const payload of [
    { ...input, amount: '-1.00' },
    { ...input, amount: '0.00' },
    { ...input, amount: '1.001' },
    { ...input, startDate: '2024-02-30' },
    { ...input, householdId: other.id },
  ]) {
    expect(
      (await app.inject({ method: 'POST', url: `/households/${home.id}/income`, payload }))
        .statusCode,
    ).toBe(400);
  }
  await api.addExpense(home.id, { ...input, amount: '-6.56' });
  expect((await api.expenses(home.id, '2024-01')).totals).toEqual([
    { currency: 'CAD', amount: '-6.56' },
  ]);
  expect((await api.overview(home.id, 1, '2024-01-31')).income).toContainEqual({
    month: '2024-01',
    currency: 'CAD',
    memberId: null,
    amount: '20.00',
  });
});
