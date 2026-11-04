import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { accountBody, accountUpdateBody, historyQuery, snapshotBody } from '../src/validation.js';

describe('backend validation', () => {
  it('defaults to a local SQLite file capped at 1 GiB', () => {
    expect(loadConfig({})).toMatchObject({
      DATABASE_PATH: './data/studious.sqlite',
      DATABASE_MAX_BYTES: 1073741824,
      PORT: 3000,
      HOST: '127.0.0.1',
      CORS_ORIGINS: [],
    });
    expect(loadConfig({ DATABASE_MAX_BYTES: '67108864' }).DATABASE_MAX_BYTES).toBe(67108864);
    for (const DATABASE_MAX_BYTES of ['1073741825', '1024', 'lots']) {
      expect(() => loadConfig({ DATABASE_MAX_BYTES })).toThrow();
    }
    expect(() => loadConfig({ DATABASE_PATH: '' })).toThrow();
    expect(
      loadConfig({ CORS_ORIGINS: 'https://user.github.io, http://127.0.0.1:4173' }).CORS_ORIGINS,
    ).toEqual(['https://user.github.io', 'http://127.0.0.1:4173']);
    for (const CORS_ORIGINS of ['*', 'https://user.github.io/studious', 'user.github.io']) {
      expect(() => loadConfig({ CORS_ORIGINS })).toThrow();
    }
  });

  it.each(['1.001', '1e3', '1000000000000.00', 'NaN', '01.00', 1.23])(
    'rejects invalid monetary input %s',
    (amount) => {
      expect(snapshotBody.safeParse({ amount, asOf: '2026-01-01T00:00:00Z' }).success).toBe(false);
    },
  );

  it('preserves decimal money as strings and accepts negative balances', () => {
    const input = { amount: '-999999999999.99', asOf: '2026-01-01T00:00:00-06:00' };
    expect(snapshotBody.parse(input)).toEqual({ amount: input.amount, asOf: new Date(input.asOf) });
  });

  it('rejects invalid dates, future balance providers and unknown fields', () => {
    expect(snapshotBody.safeParse({ amount: '1.00', asOf: 'not-a-date' }).success).toBe(false);
    expect(
      accountBody.safeParse({ name: 'Bank', type: 'SAVINGS', balanceSource: 'INTEGRATED' }).success,
    ).toBe(false);
    expect(
      accountBody.safeParse({ name: 'Bank', type: 'SAVINGS', householdId: 'injected' }).success,
    ).toBe(false);
    expect(accountUpdateBody.safeParse({}).success).toBe(false);
    expect(accountUpdateBody.safeParse({ currency: 'USD' }).success).toBe(false);
  });

  it('bounds history queries', () => {
    expect(historyQuery.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(historyQuery.safeParse({ limit: 501 }).success).toBe(false);
    expect(historyQuery.safeParse({ offset: -1 }).success).toBe(false);
  });
});
