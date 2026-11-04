import type { FinanceService } from './finance.js';
import type { createStatementRepository } from '../repositories/statements.js';
import { parseSunLifePdf } from './sunlife.js';
import { ApplicationError } from './errors.js';
import { StatementError, type DocumentExtractors } from './extractors.js';
import { parseQuestradeXlsx } from './questrade.js';

export function createStatementService(
  repository: ReturnType<typeof createStatementRepository>,
  finance: FinanceService,
  extractors: DocumentExtractors,
) {
  async function preview(
    householdId: string,
    accountId: string,
    pdf: Uint8Array,
    filename = 'statement.pdf',
    statementDate?: string,
  ) {
    const account = await finance.requireAccount(householdId, accountId);
    if (
      account.type !== 'INVESTMENT' ||
      account.currency !== 'CAD' ||
      account.balanceSource !== 'MANUAL'
    ) {
      throw new ApplicationError(
        'CONFLICT',
        'Statement imports require a manual CAD investment account.',
      );
    }
    return /\.xlsx$/i.test(filename)
      ? parseQuestradeXlsx(pdf, statementDate, extractors)
      : parseSunLifePdf(pdf, extractors);
  }
  return {
    preview,
    async extractInvestments(householdId: string, accountId: string, id: string) {
      const archive = await repository.find(householdId, accountId, id);
      if (!archive) throw new ApplicationError('NOT_FOUND', 'Archived statement not found');
      const parsed =
        archive.provider === 'QUESTRADE'
          ? await parseQuestradeXlsx(archive.pdf, archive.statementDate, extractors)
          : await parseSunLifePdf(archive.pdf, extractors);
      if (
        parsed.sha256 !== archive.sha256 ||
        parsed.amount !== archive.amount ||
        parsed.statementDate !== archive.statementDate ||
        parsed.currency !== archive.currency
      ) {
        throw new ApplicationError(
          'CONFLICT',
          'Archived export does not match its saved snapshot metadata.',
        );
      }
      if (!parsed.investments)
        throw new StatementError('No investment positions were found in this archived export.');
      const updated = await repository.updateInvestments(
        householdId,
        accountId,
        id,
        parsed.investments,
      );
      if (!updated) throw new ApplicationError('NOT_FOUND', 'Archived statement not found');
      return updated;
    },
    async import(
      householdId: string,
      accountId: string,
      filename: string,
      pdf: Uint8Array,
      statementDate?: string,
    ) {
      const parsed = await preview(householdId, accountId, pdf, filename, statementDate);
      return repository.import(householdId, accountId, filename, pdf, parsed);
    },
    list: repository.list,
    async download(householdId: string, accountId: string, id: string) {
      const archive = await repository.find(householdId, accountId, id);
      if (!archive) throw new ApplicationError('NOT_FOUND', 'Archived statement not found');
      return archive;
    },
  };
}
