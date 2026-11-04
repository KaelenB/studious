import { expect, it } from 'vitest';
import { openNodeDatabase } from '../src/db/node.js';
import { migrations } from '../src/db/migrations.generated.js';
import { expenses, households, members, expenseCategories } from '../src/models/schema.js';

it('upgrades an existing database without losing dated expenses, owners, categories or archive state', async () => {
  const connection = openNodeDatabase(':memory:');
  try {
    await connection.driver.query(
      'CREATE TABLE __studious_migrations (tag TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)',
      [],
      'run',
    );
    for (const migration of migrations.slice(0, 3)) {
      for (const sql of migration.statements) await connection.driver.query(sql, [], 'run');
      await connection.driver.query(
        'INSERT INTO __studious_migrations VALUES (?, ?, ?)',
        [migration.tag, migration.hash, Date.now()],
        'run',
      );
    }
    const [home] = await connection.db
      .insert(households)
      .values({ name: 'Before migration' })
      .returning();
    const [member] = await connection.db
      .insert(members)
      .values({ householdId: home!.id, name: 'Alex' })
      .returning();
    const [category] = await connection.db
      .insert(expenseCategories)
      .values({ householdId: home!.id, name: 'Food' })
      .returning();
    const [expense] = await connection.db
      .insert(expenses)
      .values({
        householdId: home!.id,
        memberId: member!.id,
        categoryId: category!.id,
        name: 'Historical',
        amount: '100.10',
        startDate: '2024-07-01',
        deletedAt: new Date('2025-01-01T00:00:00Z'),
      })
      .returning();
    await connection.migrate();
    await connection.migrate();
    expect(await connection.db.select().from(expenses)).toEqual([expense]);
    await connection.db.insert(expenses).values({
      householdId: home!.id,
      name: 'Refund',
      amount: '-6.56',
      startDate: '2024-07-01',
    });
    expect(await connection.driver.query('PRAGMA foreign_key_check', [], 'all')).toEqual([]);
    expect(await connection.driver.query('PRAGMA foreign_keys', [], 'get')).toEqual([[1]]);
  } finally {
    await connection.close();
  }
});
