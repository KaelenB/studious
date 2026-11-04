import {
  statementPreviewSchema,
  statementSchema,
  statementInvestmentSchema,
  type StatementArchive,
} from '@studious/api';
import type { statementArchives } from '../models/schema.js';

export function statementView(
  row: Omit<typeof statementArchives.$inferSelect, 'pdf' | 'updatedAt'>,
): StatementArchive {
  return {
    provider: statementSchema.shape.provider.parse(row.provider),
    ...(row.questrade
      ? { questrade: statementPreviewSchema.shape.questrade.parse(row.questrade) }
      : {}),
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    snapshotId: row.snapshotId,
    filename: row.filename,
    sha256: row.sha256,
    amount: row.amount,
    statementDate: row.statementDate,
    currency: statementPreviewSchema.shape.currency.parse(row.currency),
    investments:
      row.investments === null ? null : statementInvestmentSchema.array().parse(row.investments),
    byteLength: row.byteLength,
    createdAt: row.createdAt.toISOString(),
  };
}
