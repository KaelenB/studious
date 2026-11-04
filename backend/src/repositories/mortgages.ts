import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { mortgagePrepayments, mortgageTerms } from '../models/schema.js';

export type MortgageTermsValues = Omit<
  typeof mortgageTerms.$inferInsert,
  'id' | 'householdId' | 'accountId' | 'accountType' | 'createdAt' | 'updatedAt'
>;

export function createMortgageRepository(db: Database) {
  const forAccount = (householdId: string, accountId: string) =>
    and(eq(mortgageTerms.householdId, householdId), eq(mortgageTerms.accountId, accountId));
  const prepaymentsFor = (householdId: string, accountId: string) =>
    and(
      eq(mortgagePrepayments.householdId, householdId),
      eq(mortgagePrepayments.accountId, accountId),
    );

  return {
    async findTerms(householdId: string, accountId: string) {
      const [terms] = await db
        .select()
        .from(mortgageTerms)
        .where(forAccount(householdId, accountId));
      return terms;
    },
    async saveTerms(householdId: string, accountId: string, values: MortgageTermsValues) {
      const [terms] = await db
        .insert(mortgageTerms)
        .values({ ...values, householdId, accountId })
        .onConflictDoUpdate({
          target: [mortgageTerms.householdId, mortgageTerms.accountId],
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      if (!terms) throw new Error('Mortgage terms upsert returned no record');
      return terms;
    },
    listPrepayments(householdId: string, accountId: string) {
      return db
        .select()
        .from(mortgagePrepayments)
        .where(prepaymentsFor(householdId, accountId))
        .orderBy(asc(mortgagePrepayments.date), asc(mortgagePrepayments.createdAt));
    },
    async addPrepayment(input: typeof mortgagePrepayments.$inferInsert) {
      const [prepayment] = await db.insert(mortgagePrepayments).values(input).returning();
      if (!prepayment) throw new Error('Prepayment insert returned no record');
      return prepayment;
    },
    async deletePrepayment(householdId: string, accountId: string, prepaymentId: string) {
      const [prepayment] = await db
        .delete(mortgagePrepayments)
        .where(
          and(prepaymentsFor(householdId, accountId), eq(mortgagePrepayments.id, prepaymentId)),
        )
        .returning();
      return prepayment;
    },
  };
}

export type MortgageRepository = ReturnType<typeof createMortgageRepository>;
