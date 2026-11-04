import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  accounts,
  balanceSnapshots,
  households,
  members,
  type AccountUpdate,
} from '../models/schema.js';

export function createFinanceRepository(db: Database) {
  const activeAccount = (householdId: string, accountId: string) =>
    and(
      eq(accounts.householdId, householdId),
      eq(accounts.id, accountId),
      isNull(accounts.deletedAt),
    );

  return {
    async checkConnection() {
      await db.execute(sql`select 1`);
    },
    async createHousehold(input: typeof households.$inferInsert) {
      const [household] = await db.insert(households).values(input).returning();
      if (!household) throw new Error('Household insert returned no record');
      return household;
    },
    async findHousehold(householdId: string) {
      const [household] = await db.select().from(households).where(eq(households.id, householdId));
      return household;
    },
    listMembers(householdId: string) {
      return db
        .select()
        .from(members)
        .where(eq(members.householdId, householdId))
        .orderBy(members.id);
    },
    async createMember(input: typeof members.$inferInsert) {
      const [member] = await db.insert(members).values(input).returning();
      if (!member) throw new Error('Member insert returned no record');
      return member;
    },
    listAccounts(householdId: string) {
      return db
        .select()
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
        .orderBy(accounts.id);
    },
    async createAccount(input: typeof accounts.$inferInsert) {
      const [account] = await db.insert(accounts).values(input).returning();
      if (!account) throw new Error('Account insert returned no record');
      return account;
    },
    async findAccount(householdId: string, accountId: string) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(activeAccount(householdId, accountId));
      return account;
    },
    async updateAccount(householdId: string, accountId: string, input: AccountUpdate) {
      const [account] = await db
        .update(accounts)
        .set(input)
        .where(activeAccount(householdId, accountId))
        .returning();
      return account;
    },
    async archiveAccount(householdId: string, accountId: string) {
      const [account] = await db
        .update(accounts)
        .set({ deletedAt: new Date() })
        .where(activeAccount(householdId, accountId))
        .returning();
      return account;
    },
    async addSnapshot(input: typeof balanceSnapshots.$inferInsert) {
      const [snapshot] = await db.insert(balanceSnapshots).values(input).returning();
      if (!snapshot) throw new Error('Balance snapshot insert returned no record');
      return snapshot;
    },
    listSnapshots(householdId: string, accountId: string, limit: number, offset: number) {
      return db
        .select()
        .from(balanceSnapshots)
        .where(
          and(
            eq(balanceSnapshots.householdId, householdId),
            eq(balanceSnapshots.accountId, accountId),
          ),
        )
        .orderBy(desc(balanceSnapshots.asOf), desc(balanceSnapshots.id))
        .limit(limit)
        .offset(offset);
    },
  };
}

export type FinanceRepository = ReturnType<typeof createFinanceRepository>;
