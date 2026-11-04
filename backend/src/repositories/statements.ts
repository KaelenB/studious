import { and, desc, eq, getTableColumns, isNull } from 'drizzle-orm';
import type { StatementPreview } from '@studious/api';
import type { Database } from '../db/client.js';
import { accounts, balanceSnapshots, statementArchives } from '../models/schema.js';
import { ApplicationError } from '../services/errors.js';

const { pdf: _pdf, updatedAt: _updatedAt, ...metadata } = getTableColumns(statementArchives);

export function createStatementRepository(db: Database) {
  const scope = (householdId: string, accountId: string) =>
    and(eq(statementArchives.householdId, householdId), eq(statementArchives.accountId, accountId));
  return {
    async updateInvestments(
      householdId: string,
      accountId: string,
      id: string,
      investments: NonNullable<StatementPreview['investments']>,
    ) {
      const [row] = await db
        .update(statementArchives)
        .set({ investments })
        .where(and(scope(householdId, accountId), eq(statementArchives.id, id)))
        .returning(metadata);
      return row;
    },
    list(householdId: string, accountId: string, limit: number, offset: number) {
      return db
        .select(metadata)
        .from(statementArchives)
        .where(scope(householdId, accountId))
        .orderBy(desc(statementArchives.createdAt), desc(statementArchives.id))
        .limit(limit)
        .offset(offset);
    },
    async find(householdId: string, accountId: string, id: string) {
      const [row] = await db
        .select()
        .from(statementArchives)
        .where(and(scope(householdId, accountId), eq(statementArchives.id, id)));
      return row;
    },
    async import(
      householdId: string,
      accountId: string,
      filename: string,
      pdf: Buffer,
      parsed: StatementPreview,
    ) {
      return db.transaction(async (tx) => {
        // Lock the account so an archive operation cannot race a statement import.
        const [account] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.householdId, householdId),
              eq(accounts.id, accountId),
              isNull(accounts.deletedAt),
            ),
          )
          .for('update');
        if (!account) throw new ApplicationError('NOT_FOUND', 'Account not found');
        if (
          account.type !== 'INVESTMENT' ||
          account.currency !== parsed.currency ||
          account.balanceSource !== 'MANUAL'
        ) {
          throw new ApplicationError(
            'CONFLICT',
            'Statement imports require a manual CAD investment account.',
          );
        }
        const [existing] = await tx
          .select({ id: statementArchives.id })
          .from(statementArchives)
          .where(and(scope(householdId, accountId), eq(statementArchives.sha256, parsed.sha256)));
        if (existing)
          throw new ApplicationError(
            'CONFLICT',
            'This document has already been imported for this account.',
          );
        const [snapshot] = await tx
          .insert(balanceSnapshots)
          .values({
            householdId,
            accountId,
            amount: parsed.amount,
            asOf: new Date(`${parsed.statementDate}T23:59:59.999Z`),
            source: 'MANUAL',
          })
          .returning();
        if (!snapshot) throw new Error('Snapshot insert returned no record');
        const [archive] = await tx
          .insert(statementArchives)
          .values({
            ...parsed,
            provider: parsed.questrade ? 'QUESTRADE' : 'SUNLIFE',
            householdId,
            accountId,
            snapshotId: snapshot.id,
            filename,
            pdf,
            byteLength: pdf.length,
          })
          .returning(metadata);
        if (!archive) throw new Error('Statement archive insert returned no record');
        return archive;
      });
    },
  };
}
