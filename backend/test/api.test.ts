import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/database.js';
import { testDatabase } from './database.js';
import {
  accounts,
  balanceSnapshots,
  type Account,
  type Household,
  type Member,
} from '../src/models/schema.js';

describe('SQLite API integration', () => {
  let database: Awaited<ReturnType<typeof testDatabase>> | undefined;
  let app: ReturnType<typeof buildApp>;
  let household: Household;
  let otherHousehold: Household;
  let member: Member;
  let account: Account;

  beforeAll(async () => {
    database = await testDatabase();
    app = buildApp(database, false);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/households',
      payload: { name: 'Home' },
    });
    expect(response.statusCode).toBe(201);
    household = response.json<Household>();
    const otherResponse = await app.inject({
      method: 'POST',
      url: '/households',
      payload: { name: 'Other home' },
    });
    otherHousehold = otherResponse.json<Household>();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await database?.close();
  }, 30000);

  it('checks database health and household lookup', async () => {
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok', database: 'ok' });
    expect((await app.inject(`/households/${household.id}`)).json()).toMatchObject({
      name: 'Home',
      defaultCurrency: 'CAD',
    });
    expect((await app.inject(`/households/${randomUUID()}/accounts`)).statusCode).toBe(404);
    expect((await app.inject('/households/invalid/accounts')).statusCode).toBe(400);
  });

  it('creates a household member and an attributed account', async () => {
    const memberResponse = await app.inject({
      method: 'POST',
      url: `/households/${household.id}/members`,
      payload: { name: 'Alex' },
    });
    expect(memberResponse.statusCode).toBe(201);
    member = memberResponse.json<Member>();
    expect((await app.inject(`/households/${household.id}/members`)).json()).toHaveLength(1);
    const accountResponse = await app.inject({
      method: 'POST',
      url: `/households/${household.id}/accounts`,
      payload: { name: 'Chequing', type: 'CHEQUING', memberId: member.id },
    });
    expect(accountResponse.statusCode).toBe(201);
    account = accountResponse.json<Account>();
    expect(account).toMatchObject({
      householdId: household.id,
      currency: 'CAD',
      balanceSource: 'MANUAL',
    });
  });

  it('rejects cross-household member assignment on insert and update', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/households/${otherHousehold.id}/accounts`,
      payload: { name: 'Invalid', type: 'SAVINGS', memberId: member.id },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain('accounts_member_household_fk');
    const otherMember = await app.inject({
      method: 'POST',
      url: `/households/${otherHousehold.id}/members`,
      payload: { name: 'Sam' },
    });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/households/${household.id}/accounts/${account.id}`,
          payload: { memberId: otherMember.json<Member>().id },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('isolates reads, updates, archives and snapshots by household', async () => {
    expect((await app.inject(`/households/${otherHousehold.id}/accounts`)).json()).toEqual([]);
    const url = `/households/${otherHousehold.id}/accounts/${account.id}`;
    expect((await app.inject(url)).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url, payload: { name: 'Wrong' } })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(404);
    expect((await app.inject(`${url}/balances`)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/balances`,
          payload: { amount: '1.00', asOf: '2026-01-01T00:00:00Z' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('stores precise immutable snapshots and returns paginated newest-first history', async () => {
    const url = `/households/${household.id}/accounts/${account.id}/balances`;
    for (const [amount, asOf] of [
      ['123456789012.34', '2026-01-01T00:00:00Z'],
      ['-12.34', '2026-02-01T00:00:00Z'],
    ]) {
      const response = await app.inject({ method: 'POST', url, payload: { amount, asOf } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ amount, source: 'MANUAL' });
    }
    expect((await app.inject(`${url}?limit=1`)).json()).toMatchObject([{ amount: '-12.34' }]);
    expect((await app.inject(`${url}?limit=1&offset=1`)).json()).toMatchObject([
      { amount: '123456789012.34' },
    ]);
    expect((await app.inject(`${url}?limit=501`)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload: { amount: 0.1, asOf: '2026-01-01T00:00:00Z' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('enforces snapshot household boundaries even outside the API', async () => {
    if (!database) throw new Error('Database was not initialized');
    await expect(
      database.db.insert(balanceSnapshots).values({
        householdId: otherHousehold.id,
        accountId: account.id,
        amount: '1.00',
        asOf: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('validates input and does not permit mass assignment', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/households', payload: { name: ' ' } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/households/${household.id}/accounts`,
          payload: { name: 'Bank', type: 'INVALID' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/households/${household.id}/accounts`,
          payload: { name: 'Bank', type: 'SAVINGS', householdId: otherHousehold.id },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('updates and soft-deletes accounts without removing their history', async () => {
    const url = `/households/${household.id}/accounts/${account.id}`;
    const updated = await app.inject({
      method: 'PATCH',
      url,
      payload: { name: 'Everyday banking', memberId: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Everyday banking', memberId: null });
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect((await app.inject(url)).statusCode).toBe(404);
    expect((await app.inject(`${url}/balances`)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/balances`,
          payload: { amount: '1.00', asOf: '2026-01-01T00:00:00Z' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject(`/households/${household.id}/accounts`)).json()).toEqual([]);
    if (!database) throw new Error('Database was not initialized');
    const [archived] = await database.db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(archived?.deletedAt).toBeInstanceOf(Date);
    expect(
      await database.db
        .select()
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, account.id)),
    ).toHaveLength(2);
  });

  it('reports an unavailable database without leaking connection details', async () => {
    const brokenDatabase = createDatabase({
      query: () => Promise.reject(new Error('unable to open /secret/path/studious.sqlite')),
      close: async () => {},
    });
    const brokenApp = buildApp(brokenDatabase, false);
    try {
      const response = await brokenApp.inject('/health');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable', database: 'unavailable' });
      const failure = await brokenApp.inject({
        method: 'POST',
        url: '/households',
        payload: { name: 'Unavailable' },
      });
      expect(failure.statusCode).toBe(500);
      expect(failure.json()).toEqual({ error: 'Internal server error' });
    } finally {
      await brokenApp.close();
      await brokenDatabase.close();
    }
  });

  it('allows only configured static-site origins and is disabled by default', async () => {
    const corsApp = buildApp(database!, false, ['https://user.github.io']);
    try {
      const preflight = await corsApp.inject({
        method: 'OPTIONS',
        url: '/households/00000000-0000-4000-8000-000000000000/expenses/x',
        headers: {
          origin: 'https://user.github.io',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://user.github.io');
      expect(preflight.headers['access-control-allow-methods']).toContain('PATCH');
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
      const health = await corsApp.inject({
        url: '/health',
        headers: { origin: 'https://user.github.io' },
      });
      expect(health.headers['access-control-allow-origin']).toBe('https://user.github.io');
      const other = await corsApp.inject({
        url: '/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(other.headers['access-control-allow-origin']).toBeUndefined();
      const defaultApp = await app.inject({
        url: '/health',
        headers: { origin: 'https://user.github.io' },
      });
      expect(defaultApp.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await corsApp.close();
    }
  });
});
