import { expect, it } from 'vitest';
import { parseBudgetWorkbook } from '../src/services/budget-parser.js';
import type { DocumentExtractors } from '../src/services/extractors.js';

const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
const sheets = (expenseRows: unknown[][], incomeRows: unknown[][] = []): DocumentExtractors => ({
  pdfText: async () => {
    throw new Error('Not used');
  },
  workbookSheets: async () => ({
    Expenses: [['Date', 'Cost', 'Description', 'Category', 'Paid By'], ...expenseRows],
    Income: [['Date', 'Amount', 'Description', 'Whose'], ...incomeRows],
  }),
});

it('rounds decimal strings exactly, including half-cent refunds, and preserves Excel date instants', async () => {
  const parsed = await parseBudgetWorkbook(
    bytes,
    'Budget - 2024.xlsx',
    'CAD',
    sheets([
      ['2024-01-01T00:00:00.000Z', '1.005', 'Expense', 'Food', 'Alex'],
      ['2024-01-02', '-1.005', 'Refund', 'Food', 'Alex'],
      ['2024-01-03', '999999999999.9900', 'Large', null, 'Alex'],
    ]),
  );
  expect(parsed.issues).toEqual([]);
  expect(parsed.rows.map((row) => row.amount)).toEqual(['1.01', '-1.01', '999999999999.99']);
  expect(parsed.rows[0]?.date).toBe('2024-01-01');
  expect(parsed.warnings).toHaveLength(2);
  expect(parsed.totals[0]?.amount).toBe('999999999999.99');
});

it('reports every invalid populated row, ignores only empty transaction columns and blocks overflow', async () => {
  const parsed = await parseBudgetWorkbook(
    bytes,
    'Budget.xlsx',
    'CAD',
    sheets([
      ['2024-02-30', '10', 'Bad date', 'Food', 'Alex'],
      ['2024-02-01', '0', 'Zero', 'Food', 'Alex'],
      ['2024-02-01', '1.00', 'No member', 'Food', ''],
      ['2024-02-01', '999999999999.999', 'Overflow', null, 'Alex'],
      ['2024-02-01', '=SUM(A1)', 'Formula without cached value', null, 'Alex'],
      ['', '', '', '', '', 'helper'],
    ]),
  );
  expect(parsed.issues.map((row) => row.row)).toEqual([2, 3, 4, 5, 6]);
  expect(parsed.rows).toEqual([]);
});
