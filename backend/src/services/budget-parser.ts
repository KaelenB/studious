import { z } from 'zod';
import {
  budgetFileLimit,
  expenseBody,
  incomeBody,
  type BudgetPreview,
  type BudgetRow,
} from '@studious/api';
import { sha256Hex, startsWith, StatementError, type DocumentExtractors } from './extractors.js';
import { centsToMoney } from '../repositories/expenses.js';

const cells = z
  .array(z.array(z.union([z.string().max(1000), z.number().finite(), z.null()])).max(40))
  .max(10001);
const sheetsSchema = z.object({ Expenses: cells, Income: cells });
const text = (value: string | number | null | undefined) => String(value ?? '').trim();
const normal = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const hash = (value: string) => sha256Hex(new TextEncoder().encode(value));

function amount(value: string) {
  if (!/^-?\d{1,12}(?:\.\d{1,10})?$/.test(value))
    throw new Error('Amount must be a decimal number with at most 12 integer digits');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  let result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if (Number(fraction[2] ?? '0') >= 5) result++;
  return {
    value: centsToMoney(negative ? -result : result),
    rounded: /[1-9]/.test(fraction.slice(2)),
  };
}

export async function parseBudgetWorkbook(
  bytes: Uint8Array,
  filename: string,
  currency: string,
  extractors: DocumentExtractors,
): Promise<BudgetPreview> {
  if (!bytes.length || bytes.length > budgetFileLimit || !startsWith(bytes, [0x50, 0x4b, 3, 4]))
    throw new StatementError('Upload a valid XLSX no larger than 10 MiB.');
  const raw = sheetsSchema.safeParse(
    await extractors.workbookSheets(bytes, ['Expenses', 'Income'], { rows: 10001, columns: 40 }),
  );
  if (!raw.success)
    throw new StatementError(
      'Unsupported budget cells. Use Expenses and Income sheets with at most 10,000 data rows each.',
    );
  const result: BudgetPreview = {
    sha256: await sha256Hex(bytes),
    currency,
    rows: [],
    issues: [],
    warnings: [],
    owners: [],
    totals: [],
  };
  const workbookYear = filename.match(/\b(20\d{2})\b/)?.[1];
  const occurrences = new Map<string, number>();
  const owners = new Set<string>();
  for (const sheet of ['Expenses', 'Income'] as const) {
    const required =
      sheet === 'Expenses'
        ? ['Date', 'Cost', 'Description', 'Category', 'Paid By']
        : ['Date', 'Amount', 'Description', 'Whose'];
    const rows = raw.data[sheet];
    const header = rows[0]?.map((value) => normal(text(value))) ?? [];
    const columns = required.map((label) => header.indexOf(normal(label)));
    if (columns.some((index) => index < 0))
      throw new StatementError(`${sheet}: required headers are ${required.join(', ')}.`);
    let total = 0n;
    let count = 0;
    for (let index = 1; index < rows.length; index++) {
      const row = rows[index]!;
      const values = columns.map((column) => text(row[column]));
      if (values.every((value) => !value)) continue;
      const sourceRow = index + 1;
      try {
        const [dateText = '', rawAmount = '', name = ''] = values;
        const category = sheet === 'Expenses' ? values[3]! || null : null;
        const owner = values[sheet === 'Expenses' ? 4 : 3]!;
        if (!owner || owner.length > 200)
          throw new Error('A member name (Paid By/Whose) is required, at most 200 characters');
        const date = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(dateText)
          ? dateText.slice(0, 10)
          : dateText;
        const parsedAmount = amount(rawAmount);
        const input = { name, amount: parsedAmount.value, currency, startDate: date };
        const validated = (sheet === 'Expenses' ? expenseBody : incomeBody).safeParse(input);
        if (!validated.success)
          throw new Error(
            validated.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; '),
          );
        if (category && category.length > 200)
          throw new Error('Category must be at most 200 characters');
        const identity = JSON.stringify([
          sheet,
          date,
          parsedAmount.value,
          currency,
          normal(name),
          category ? normal(category) : null,
          normal(owner),
        ]);
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        const record: BudgetRow = {
          sheet,
          row: sourceRow,
          date,
          amount: parsedAmount.value,
          name: validated.data.name,
          category,
          owner,
          key: await hash(`${identity}:${occurrence}`),
          duplicate: false,
        };
        result.rows.push(record);
        owners.add(owner);
        total += BigInt(record.amount.replace('.', ''));
        count++;
        if (parsedAmount.rounded)
          result.warnings.push(
            `${sheet} row ${sourceRow}: rounded ${rawAmount} to ${record.amount} (nearest cent, half away from zero).`,
          );
        if (workbookYear && date.slice(0, 4) !== workbookYear)
          result.warnings.push(
            `${sheet} row ${sourceRow}: ${date} differs from workbook year ${workbookYear}; the recorded date will be preserved.`,
          );
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        result.issues.push({ sheet, row: sourceRow, message: error.message });
      }
    }
    result.totals.push({ sheet, amount: centsToMoney(total), count });
  }
  result.owners = [...owners].sort();
  if (result.owners.length > 50)
    throw new StatementError('A budget import supports at most 50 member names.');
  if (!result.rows.length && !result.issues.length)
    throw new StatementError('The Expenses and Income sheets contain no transaction rows.');
  return result;
}
