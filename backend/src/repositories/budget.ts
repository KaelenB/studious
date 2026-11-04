import { eq } from 'drizzle-orm';
import type { BudgetMemberMapping, BudgetPreview } from '@studious/api';
import type { Database } from '../db/database.js';
import {
  budgetImportRows,
  expenseCategories,
  expenses,
  income,
  members,
} from '../models/schema.js';
import { ApplicationError } from '../services/errors.js';

export function createBudgetRepository(db: Database) {
  return {
    async keys(householdId: string) {
      return new Set(
        (
          await db
            .select({ key: budgetImportRows.key })
            .from(budgetImportRows)
            .where(eq(budgetImportRows.householdId, householdId))
        ).map((row) => row.key),
      );
    },
    import(
      householdId: string,
      filename: string,
      preview: BudgetPreview,
      mapping: BudgetMemberMapping,
    ) {
      return db.transaction(async (tx) => {
        const existing = new Set(
          (
            await tx
              .select({ key: budgetImportRows.key })
              .from(budgetImportRows)
              .where(eq(budgetImportRows.householdId, householdId))
          ).map((row) => row.key),
        );
        const householdMembers = await tx
          .select()
          .from(members)
          .where(eq(members.householdId, householdId));
        for (const owner of preview.owners) {
          if (!Object.hasOwn(mapping, owner))
            throw new ApplicationError('INVALID', `Choose a household member for ${owner}`);
          const target = mapping[owner];
          if (
            target !== 'CREATE' &&
            target !== null &&
            !householdMembers.some((member) => member.id === target)
          )
            throw new ApplicationError(
              'INVALID',
              `Member mapping for ${owner} does not belong to this household`,
            );
        }
        const memberIds = new Map<string, string | null>();
        const categories = await tx
          .select()
          .from(expenseCategories)
          .where(eq(expenseCategories.householdId, householdId));
        const categoryIds = new Map(categories.map((category) => [category.name, category.id]));
        const result = { expenses: 0, income: 0, duplicates: 0 };
        for (const row of preview.rows) {
          if (existing.has(row.key)) {
            result.duplicates++;
            continue;
          }
          if (!memberIds.has(row.owner)) {
            const target = mapping[row.owner]!;
            if (target === 'CREATE') {
              const matches = householdMembers.filter(
                (member) => member.name.toLowerCase() === row.owner.toLowerCase(),
              );
              if (matches.length > 1)
                throw new ApplicationError(
                  'CONFLICT',
                  `Several members match ${row.owner}; select one explicitly`,
                );
              let member = matches[0];
              if (!member) {
                [member] = await tx
                  .insert(members)
                  .values({ householdId, name: row.owner })
                  .returning();
                if (!member) throw new Error('Imported member insert returned no record');
                householdMembers.push(member);
              }
              memberIds.set(row.owner, member.id);
            } else memberIds.set(row.owner, target);
          }
          let categoryId: string | null = null;
          if (row.sheet === 'Expenses' && row.category) {
            categoryId = categoryIds.get(row.category) ?? null;
            if (!categoryId) {
              const [category] = await tx
                .insert(expenseCategories)
                .values({ householdId, name: row.category })
                .returning();
              if (!category) throw new Error('Imported category insert returned no record');
              categoryIds.set(row.category, category.id);
              categoryId = category.id;
            }
          }
          const values = {
            householdId,
            memberId: memberIds.get(row.owner)!,
            name: row.name,
            amount: row.amount,
            currency: preview.currency,
            startDate: row.date,
          };
          const [record] =
            row.sheet === 'Expenses'
              ? await tx
                  .insert(expenses)
                  .values({ ...values, categoryId })
                  .returning({ id: expenses.id })
              : await tx.insert(income).values(values).returning({ id: income.id });
          if (!record) throw new Error('Imported transaction insert returned no record');
          await tx.insert(budgetImportRows).values({
            householdId,
            key: row.key,
            fileHash: preview.sha256,
            filename,
            sheet: row.sheet,
            row: row.row,
            recordId: record.id,
          });
          existing.add(row.key);
          result[row.sheet === 'Expenses' ? 'expenses' : 'income']++;
        }
        return result;
      });
    },
  };
}
export type BudgetRepository = ReturnType<typeof createBudgetRepository>;
