import { expect, it, vi } from 'vitest';
import { createApiClient } from '@studious/api';
import { createMarketHistory } from '../src/services/market.js';
import { createStatementRepository } from '../src/repositories/statements.js';
import { testDatabase } from './database.js';
import { buildApp } from '../src/app.js';

const asOf = '2026-11-04';
const fixture = (symbol = 'TEST.TO', currency = 'CAD') => ({
  chart: {
    result: [
      {
        meta: { symbol, currency, instrumentType: 'ETF', longName: 'Synthetic index ETF' },
        timestamp: ['2021-11-08', '2024-01-02', '2026-11-03'].map(
          (day) => Date.parse(`${day}T16:00:00Z`) / 1000,
        ),
        indicators: { adjclose: [{ adjclose: [10, 15, 20] }], quote: [{ close: [11, 16, 21] }] },
      },
    ],
  },
});

it('validates adjusted-history CAGR, currency and security identity, and caches requests', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture()));
  const history = createMarketHistory(transport);
  const result = await history('TEST.TO', 'CAD', asOf);
  expect(result.price).toBe(21);
  expect(result.historyStart).toBe('2021-11-08');
  expect(result.annualReturn).toBeCloseTo(
    (2 ** (365.25 / ((Date.parse('2026-11-03') - Date.parse('2021-11-08')) / 86400000)) - 1) * 100,
    4,
  );
  await history('TEST.TO', 'CAD', asOf);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(String(transport.mock.calls[0]![0])).toContain('interval=1d');
  await expect(history('https://bad', 'CAD', asOf)).rejects.toThrow('Unsupported ticker');
  await expect(history('WRONG.TO', 'CAD', asOf)).rejects.toThrow('did not match');
  await expect(history('TEST.TO', 'USD', asOf)).rejects.toThrow('did not match');
});

it('rejects short histories, stale data and provider failures without inventing returns', async () => {
  const short = fixture();
  short.chart.result[0]!.timestamp[0] = Date.parse('2025-01-01') / 1000;
  await expect(
    createMarketHistory(async () => Response.json(short))('TEST.TO', 'CAD', asOf),
  ).rejects.toThrow('three years');
  await expect(
    createMarketHistory(async () => new Response('', { status: 429 }))('TEST.TO', 'CAD', asOf),
  ).rejects.toThrow('HTTP 429');
  await expect(
    createMarketHistory(async () => Response.json({ bad: true }))('TEST.TO', 'CAD', asOf),
  ).rejects.toThrow('unsupported history');
  const stale = fixture();
  stale.chart.result[0]!.timestamp[2] = Date.parse('2026-01-01') / 1000;
  await expect(
    createMarketHistory(async () => Response.json(stale))('TEST.TO', 'CAD', asOf),
  ).rejects.toThrow('stale');
  await expect(
    createMarketHistory(async () => new Response('x'.repeat(1_000_001)))('TEST.TO', 'CAD', asOf),
  ).rejects.toThrow('size limit');
});

it('scopes latest-statement holdings and weights market returns by recorded portfolio coverage', async () => {
  const database = await testDatabase();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(String(url).includes('/FOREIGN?') ? fixture('FOREIGN', 'USD') : fixture()),
    );
  const app = buildApp(database, false, [], undefined, transport);
  try {
    const api = createApiClient(await app.listen({ host: '127.0.0.1', port: 0 }));
    const home = await api.createHousehold('Market test', 'CAD');
    const account = await api.addAccount(home.id, {
      name: 'TFSA',
      type: 'INVESTMENT',
      subtype: 'TFSA',
    });
    const unknown = await api.addAccount(home.id, {
      name: 'Untickered plan',
      type: 'INVESTMENT',
      subtype: 'DCPP',
    });
    await api.addBalance(home.id, unknown.id, '100.00', '2026-10-01T00:00:00Z');
    await createStatementRepository(database.db).import(
      home.id,
      account.id,
      'synthetic.xlsx',
      new Uint8Array([1]),
      {
        amount: '100.00',
        statementDate: '2026-10-01',
        currency: 'CAD',
        sha256: 'a'.repeat(64),
        investments: [
          {
            name: 'Synthetic fund',
            symbol: 'TEST',
            currency: 'CAD',
            category: 'ETF',
            units: '1',
            unitPrice: '50',
            value: '50.00',
          },
          {
            name: 'Foreign fund',
            symbol: 'FOREIGN',
            currency: 'USD',
            category: 'ETF',
            units: '1',
            unitPrice: '10',
            value: '10.00',
          },
        ],
      },
    );
    const response = await api.investmentMarket(home.id, asOf, 'CAD');
    expect(response.coveragePercent).toBe(25);
    const scoped = await api.investmentMarket(home.id, asOf, 'CAD', undefined, account.id);
    expect(scoped.coveragePercent).toBe(50);
    expect(scoped.holdings.every((holding) => holding.accountId === account.id)).toBe(true);
    const matched = response.holdings.find((holding) => holding.symbol === 'TEST.TO')!;
    expect(response.annualReturn).toBeCloseTo(matched.annualReturn! / 4);
    expect(response.holdings.find((holding) => holding.symbol === 'FOREIGN')!.error).toContain(
      'Native currency',
    );
    expect(response.holdings.find((holding) => holding.symbol === null)!.error).toContain(
      'No explicit',
    );
    expect(response.holdings.find((holding) => holding.symbol === 'FOREIGN')!.price).toBe(21);
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mockImplementationOnce(async () => new Response('', { status: 429 }));
    const unavailable = await api.investmentMarket(home.id, '2026-11-03', 'CAD');
    expect(unavailable.annualReturn).toBeNull();
    expect(unavailable.holdings.find((holding) => holding.symbol === 'TEST.TO')!.error).toContain(
      'HTTP 429',
    );
    expect((await api.investmentMarket(home.id, '2026-11-03', 'CAD')).annualReturn).not.toBeNull();
    const other = await api.createHousehold('Other household', 'CAD');
    await expect(
      api.investmentMarket(other.id, asOf, 'CAD', undefined, account.id),
    ).rejects.toMatchObject({ status: 404 });
    expect((await api.investmentMarket(other.id, asOf, 'CAD')).holdings).toEqual([]);
    expect((await api.investmentMarket(home.id, '2026-09-01', 'CAD')).annualReturn).toBeNull();
    expect(
      (await app.inject(`/households/${home.id}/investment-market?asOf=9999-12-01&currency=CAD`))
        .statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    await database.close();
  }
});
