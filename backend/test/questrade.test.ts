import { expect, it } from 'vitest';
import { parseQuestradeXlsx } from '../src/services/questrade.js';
import { questradeXlsx } from './fixtures/questrade.js';

it('extracts combined equity, cash, FX and native-currency positions without losing decimals', async () => {
  const parsed = await parseQuestradeXlsx(questradeXlsx(), '2026-10-31');
  expect(parsed).toMatchObject({
    amount: '117.56',
    statementDate: '2026-10-31',
    currency: 'CAD',
    questrade: {
      accountType: 'Individual TFSA',
      fxRate: '1.40000',
      cashCAD: '2.16',
      cashUSD: '1.00',
      combinedCashCAD: '3.56',
    },
    investments: [
      { symbol: 'ETF', units: '2.00001', unitPrice: '50.0000', currency: 'CAD', value: '100.00' },
      { symbol: 'STK', currency: 'USD', value: '10.00' },
    ],
  });
});
it('requires an explicitly supplied observation date', async () => {
  await expect(parseQuestradeXlsx(questradeXlsx(), undefined)).rejects.toThrow('observation date');
  await expect(parseQuestradeXlsx(questradeXlsx(), '2026-02-30')).rejects.toThrow(
    'observation date',
  );
});
it.each([{ badTotal: true }, { otherAccount: true }, { empty: true }])(
  'rejects inconsistent or unsupported workbook data',
  async (options) => {
    await expect(parseQuestradeXlsx(questradeXlsx(options), '2026-10-31')).rejects.toThrow();
  },
);
it('rejects damaged and oversized workbooks', async () => {
  await expect(parseQuestradeXlsx(Buffer.from('not xlsx'), '2026-10-31')).rejects.toThrow(
    'valid XLSX',
  );
  await expect(parseQuestradeXlsx(Buffer.from([0x50, 0x4b, 3, 4]), '2026-10-31')).rejects.toThrow(
    'Cannot read',
  );
  await expect(parseQuestradeXlsx(Buffer.alloc(10485761), '2026-10-31')).rejects.toThrow('10 MiB');
});
