import type { BudgetMemberMapping } from '@studious/api';
import type { BudgetRepository } from '../repositories/budget.js';
import { parseBudgetWorkbook } from './budget-parser.js';
import { StatementError, type DocumentExtractors } from './extractors.js';

export function createBudgetService(repository: BudgetRepository, extractors: DocumentExtractors) {
  async function preview(
    householdId: string,
    filename: string,
    currency: string,
    bytes: Uint8Array,
  ) {
    const parsed = await parseBudgetWorkbook(bytes, filename, currency, extractors);
    const keys = await repository.keys(householdId);
    parsed.rows.forEach((row) => (row.duplicate = keys.has(row.key)));
    return parsed;
  }
  return {
    preview,
    async import(
      householdId: string,
      filename: string,
      currency: string,
      bytes: Uint8Array,
      sha256: string,
      members: BudgetMemberMapping,
    ) {
      const parsed = await preview(householdId, filename, currency, bytes);
      if (parsed.sha256 !== sha256)
        throw new StatementError('Workbook changed after preview. Review it again.');
      if (parsed.issues.length)
        throw new StatementError(
          'Correct every invalid row in the workbook and preview again. No rows were imported.',
        );
      return repository.import(householdId, filename, parsed, members);
    },
  };
}
export type BudgetService = ReturnType<typeof createBudgetService>;
