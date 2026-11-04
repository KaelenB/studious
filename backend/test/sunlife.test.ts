import { expect, it } from 'vitest';
import {
  parseSunLifePdf as parsePdf,
  parseSunLifeText,
  parseSunLifeInvestments,
} from '../src/services/sunlife.js';
import { nodeExtractors } from '../src/services/extractors.node.js';
import { sunLifePdf, sunLifeInvestmentPdf } from './fixtures/sunlife.js';

const parseSunLifePdf = (pdf: Uint8Array) => parsePdf(pdf, nodeExtractors);

it('extracts the latest total plan value from a real text-based PDF', async () => {
  expect(await parseSunLifePdf(sunLifePdf())).toMatchObject({
    amount: '1234.56',
    statementDate: '2026-09-30',
    currency: 'CAD',
  });
});

it('does not confuse contributions, opening balances or individual funds with the closing total', () => {
  expect(
    parseSunLifeText(
      'Sun Life\nFor the period July 1 to September 30, 2026\nValue of my plan on Jul 1, 2026 .... $9,999.99\nFund value $99,999.00\nValue of my plan on September 30, 2026 ... $123,456,789,012.34',
    ),
  ).toEqual({
    amount: '123456789012.34',
    statementDate: '2026-09-30',
    currency: 'CAD',
    investments: null,
  });
});

it.each([
  'Other provider\nValue of my plan on Sep 30, 2026 ... $123.45',
  'Sun Life\nContributions $123.45',
  'Sun Life\nValue of my plan on Feb 30, 2026 ... $123.45',
  'Sun Life\nValue of my plan on Sep 30, 2026 ... $123.45\nValue of my plan on Sep 30, 2026 ... $999.00',
  'Sun Life USD\nValue of my plan on Sep 30, 2026 ... $123.45',
  'Sun Life\nValue of my plan on Sep 30, 2026 ... $123.456',
])('rejects unsupported, ambiguous or invalid statement text', (text) => {
  expect(() => parseSunLifeText(`For the period July 1 to September 30, 2026\n${text}`)).toThrow();
});

it('rejects fake, damaged, oversized and image-only/unrecognized PDFs', async () => {
  await expect(parseSunLifePdf(Buffer.from('not a PDF'))).rejects.toThrow('valid PDF');
  await expect(parseSunLifePdf(Buffer.from('%PDF-1.4\nbroken'))).rejects.toThrow('Cannot read');
  await expect(parseSunLifePdf(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow('10 MiB');
  await expect(
    parseSunLifePdf(sunLifePdf(['Sun Life', 'For the period July 1 to September 30, 2026'])),
  ).rejects.toThrow('No dated');
});

it('rejects a statement with only an opening balance instead of guessing the closing value', () => {
  expect(() =>
    parseSunLifeText(
      'Sun Life\nFor the period July 1 to September 30, 2026\nValue of my plan on Jul 1, 2026 ... $1,000.00',
    ),
  ).toThrow('closing date');
});

it('extracts multiple investment rows, categories, wrapped names and exact units/prices from PDF', async () => {
  const parsed = await parseSunLifePdf(sunLifeInvestmentPdf());
  expect(parsed.investments).toEqual([
    {
      name: 'Example Balanced Fund',
      category: 'Balanced',
      units: '10.12345',
      unitPrice: '12.3456',
      value: '1000.00',
    },
    {
      name: 'Example Bond Fund',
      category: 'Fixed income',
      units: '20.50000',
      unitPrice: '11.4420',
      value: '234.56',
    },
  ]);
});

const investmentTable = [
  'My investments',
  'INVESTMENT NAME NUMBER OF UNITS',
  'PRICE ON SEP 30, 2026',
  'VALUE ON SEP 30, 2026',
  'Balanced',
  'Example Fund 2,468.13579 $12.3456 $30,470.31',
  'Total investments $30,470.31',
  'How ongoing contributions are invested',
  'Example Fund 100.00% 100.00%',
].join('\n');

it('parses the supplied layout with thousands separators without rounding units or prices', () => {
  expect(parseSunLifeInvestments(investmentTable, '2026-09-30', '30470.31')).toEqual([
    {
      name: 'Example Fund',
      category: 'Balanced',
      units: '2468.13579',
      unitPrice: '12.3456',
      value: '30470.31',
    },
  ]);
  expect(parseSunLifeInvestments('No investment table', '2026-09-30', '30470.31')).toBeNull();
});

it.each([
  investmentTable.replace('VALUE ON SEP 30, 2026', 'VALUE ON JUN 30, 2026'),
  investmentTable.replace('Total investments $30,470.31', 'Total investments $30,470.32'),
  investmentTable.replace('$12.3456 $30,470.31', '$12.3456 $30,470.30'),
  investmentTable.replace('Total investments $30,470.31', ''),
  investmentTable.replace('2,468.13579', '2,468.135791234'),
  investmentTable.replace('Total investments', 'Unreadable Fund\nTotal investments'),
  `${investmentTable}\n${investmentTable}`,
])(
  'rejects incomplete or inconsistent investment tables rather than silently skipping rows',
  (text) => {
    expect(() => parseSunLifeInvestments(text, '2026-09-30', '30470.31')).toThrow();
  },
);
