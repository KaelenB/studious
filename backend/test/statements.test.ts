import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApiClient, statementFileLimit } from '@studious/api';
import { buildApp } from '../src/app.js';
import { testDatabase } from './database.js';
import { StorageLimitError } from '../src/db/errors.js';
import { balanceSnapshots, statementArchives } from '../src/models/schema.js';
import { sunLifePdf, sunLifeInvestmentPdf } from './fixtures/sunlife.js';
import { questradeXlsx } from './fixtures/questrade.js';
let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof buildApp>;
let api: ReturnType<typeof createApiClient>;

beforeAll(async () => {
  database = await testDatabase();
  app = buildApp(database, false);
  api = createApiClient(await app.listen({ host: '127.0.0.1', port: 0 }));
}, 180000);

afterAll(async () => {
  await app?.close();
  await database?.close();
}, 30000);

async function setup() {
  const home = await api.createHousehold('Statement home', 'CAD');
  const account = await api.addAccount(home.id, { name: 'Sun Life pension', type: 'INVESTMENT' });
  return { home, account };
}
const file = () => new Blob([new Uint8Array(sunLifePdf())], { type: 'application/pdf' });

it('previews without writes, then saves a linked snapshot and byte-identical downloadable archive', async () => {
  const { home, account } = await setup();
  const preview = await api.previewStatement(home.id, account.id, 'sunlife.pdf', file());
  expect(preview).toEqual({
    amount: '1234.56',
    statementDate: '2026-09-30',
    currency: 'CAD',
    sha256: createHash('sha256').update(sunLifePdf()).digest('hex'),
    investments: null,
  });
  expect(await api.balances(home.id, account.id)).toEqual([]);
  expect(await api.statements(home.id, account.id)).toEqual([]);
  const archive = await api.importStatement(home.id, account.id, 'sunlife.pdf', file());
  expect(archive).toMatchObject({
    ...preview,
    filename: 'sunlife.pdf',
    byteLength: sunLifePdf().length,
  });
  const balances = await api.balances(home.id, account.id);
  expect(balances).toMatchObject([
    {
      id: archive.snapshotId,
      amount: '1234.56',
      asOf: '2026-09-30T23:59:59.999Z',
      source: 'MANUAL',
    },
  ]);
  expect(await api.statements(home.id, account.id, 1, 0)).toEqual([archive]);
  expect(await api.statements(home.id, account.id, 1, 1)).toEqual([]);
  const blob = await api.downloadStatement(home.id, account.id, archive.id);
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(sunLifePdf());
  const response = await app.inject(
    `/households/${home.id}/accounts/${account.id}/statements/${archive.id}/pdf`,
  );
  expect(response.headers['content-disposition']).toContain('attachment;');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['content-security-policy']).toContain('sandbox');
  expect(JSON.stringify(archive)).not.toContain('%PDF');
});

it('prevents duplicates including concurrent retries without leaving orphan snapshots', async () => {
  const { home, account } = await setup();
  const results = await Promise.allSettled([
    api.importStatement(home.id, account.id, 'a.pdf', file()),
    api.importStatement(home.id, account.id, 'renamed.pdf', file()),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find((result) => result.status === 'rejected');
  expect(failed?.status === 'rejected' && failed.reason.status).toBe(409);
  expect(await api.balances(home.id, account.id)).toHaveLength(1);
  expect(await api.statements(home.id, account.id)).toHaveLength(1);
});

it('rolls back the snapshot if archival fails', async () => {
  const { home, account } = await setup();
  // The size constraint rejects this archive even though the snapshot insert succeeds first.
  const { createStatementRepository } = await import('../src/repositories/statements.js');
  const repository = createStatementRepository(database.db);
  await expect(
    repository.import(home.id, account.id, 'bad.pdf', Buffer.alloc(0), {
      amount: '1234.56',
      statementDate: '2026-09-30',
      currency: 'CAD',
      sha256: '0'.repeat(64),
      investments: null,
    }),
  ).rejects.toThrow();
  expect(await api.balances(home.id, account.id)).toEqual([]);
  expect(await api.statements(home.id, account.id)).toEqual([]);
});

it('isolates preview, import, metadata and downloads by household and account', async () => {
  const { home, account } = await setup();
  const other = await setup();
  const archive = await api.importStatement(home.id, account.id, 'private.pdf', file());
  expect(await api.statements(other.home.id, account.id)).toEqual([]);
  expect(await api.statements(home.id, other.account.id)).toEqual([]);
  await expect(
    api.previewStatement(other.home.id, account.id, 'private.pdf', file()),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    api.importStatement(other.home.id, account.id, 'private.pdf', file()),
  ).rejects.toMatchObject({ status: 404 });
  await expect(api.downloadStatement(other.home.id, account.id, archive.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(api.downloadStatement(home.id, other.account.id, archive.id)).rejects.toMatchObject({
    status: 404,
  });
  const [stored] = await database.db
    .select()
    .from(statementArchives)
    .where(eq(statementArchives.id, archive.id));
  if (!stored) throw new Error('Missing archived statement');
  await expect(
    database.db.insert(statementArchives).values({
      ...stored,
      id: randomUUID(),
      householdId: other.home.id,
      accountId: other.account.id,
    }),
  ).rejects.toThrow();
});

it('preserves archive access after account archival but disallows further imports', async () => {
  const { home, account } = await setup();
  const archive = await api.importStatement(home.id, account.id, 'pension.pdf', file());
  await api.archiveAccount(home.id, account.id);
  expect(await api.statements(home.id, account.id)).toEqual([archive]);
  expect((await api.downloadStatement(home.id, account.id, archive.id)).size).toBe(
    sunLifePdf().length,
  );
  await expect(
    api.importStatement(home.id, account.id, 'pension.pdf', file()),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    await database.db
      .select()
      .from(balanceSnapshots)
      .where(
        and(eq(balanceSnapshots.householdId, home.id), eq(balanceSnapshots.accountId, account.id)),
      ),
  ).toHaveLength(1);
});

it('rejects invalid PDFs, unsafe filenames, oversized bodies and incompatible accounts', async () => {
  const { home, account } = await setup();
  const base = `/households/${home.id}/accounts/${account.id}/statements`;
  for (const [payload, status] of [
    [Buffer.from('not pdf'), 422],
    [Buffer.from('%PDF-1.4\nbroken'), 422],
    [Buffer.alloc(statementFileLimit + 1), 413],
  ] as const) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}/preview?filename=test.pdf`,
          headers: { 'content-type': 'application/pdf' },
          payload,
        })
      ).statusCode,
    ).toBe(status);
  }
  for (const filename of ['../test.pdf', 'test.txt', 'x\r\nname.pdf']) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${base}?filename=${encodeURIComponent(filename)}`,
          headers: { 'content-type': 'application/pdf' },
          payload: sunLifePdf(),
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base}/preview?filename=test.pdf`,
        payload: { fake: true },
      })
    ).statusCode,
  ).toBe(422);
  expect((await app.inject(`${base}?limit=501`)).statusCode).toBe(400);
  for (const input of [
    { type: 'SAVINGS' as const },
    { type: 'INVESTMENT' as const, currency: 'USD' },
  ]) {
    const invalid = await api.addAccount(home.id, { name: 'Incompatible', ...input });
    await expect(
      api.previewStatement(home.id, invalid.id, 'test.pdf', file()),
    ).rejects.toMatchObject({ status: 409 });
  }
  expect(await api.balances(home.id, account.id)).toEqual([]);
});

it('stores investment details and re-extracts legacy archives without creating another snapshot', async () => {
  const { home, account } = await setup();
  const investmentFile = new Blob([new Uint8Array(sunLifeInvestmentPdf())], {
    type: 'application/pdf',
  });
  const preview = await api.previewStatement(
    home.id,
    account.id,
    'investments.pdf',
    investmentFile,
  );
  expect(preview.investments).toHaveLength(2);
  const archive = await api.importStatement(home.id, account.id, 'investments.pdf', investmentFile);
  expect(archive.investments).toEqual(preview.investments);
  expect((await api.statements(home.id, account.id))[0]?.investments).toEqual(preview.investments);
  await database.db
    .update(statementArchives)
    .set({ investments: null })
    .where(eq(statementArchives.id, archive.id));
  expect((await api.statements(home.id, account.id))[0]?.investments).toBeNull();
  const extracted = await api.extractStatementInvestments(home.id, account.id, archive.id);
  expect(extracted.investments).toEqual(preview.investments);
  expect(extracted.snapshotId).toBe(archive.snapshotId);
  expect(extracted.sha256).toBe(archive.sha256);
  expect(extracted.createdAt).toBe(archive.createdAt);
  await api.extractStatementInvestments(home.id, account.id, archive.id);
  expect(await api.balances(home.id, account.id)).toHaveLength(1);
  expect(
    Buffer.from(await (await api.downloadStatement(home.id, account.id, archive.id)).arrayBuffer()),
  ).toEqual(sunLifeInvestmentPdf());
  const other = await setup();
  await expect(
    api.extractStatementInvestments(other.home.id, account.id, archive.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    api.extractStatementInvestments(home.id, other.account.id, archive.id),
  ).rejects.toMatchObject({ status: 404 });
  await api.archiveAccount(home.id, account.id);
  expect(
    (await api.extractStatementInvestments(home.id, account.id, archive.id)).investments,
  ).toEqual(preview.investments);
});

it('reports missing investment sections on legacy extraction without changing balances or metadata', async () => {
  const { home, account } = await setup();
  const archive = await api.importStatement(home.id, account.id, 'summary.pdf', file());
  await expect(
    api.extractStatementInvestments(home.id, account.id, archive.id),
  ).rejects.toMatchObject({ status: 422 });
  expect(await api.statements(home.id, account.id)).toEqual([archive]);
  expect(await api.balances(home.id, account.id)).toHaveLength(1);
});

it('previews and imports a Questrade XLSX with native currencies, cash, atomic archive and duplicate protection', async () => {
  const { home, account } = await setup();
  const workbook = new Blob([new Uint8Array(questradeXlsx())]);
  await expect(
    api.previewStatement(home.id, account.id, 'InvestmentSummary.xlsx', workbook),
  ).rejects.toMatchObject({ status: 422 });
  const parsed = await api.previewStatement(
    home.id,
    account.id,
    'InvestmentSummary.xlsx',
    workbook,
    undefined,
    '2026-10-31',
  );
  expect(parsed.amount).toBe('117.56');
  expect(parsed.investments?.[1]?.currency).toBe('USD');
  expect(await api.balances(home.id, account.id)).toEqual([]);
  const archive = await api.importStatement(
    home.id,
    account.id,
    'InvestmentSummary.xlsx',
    workbook,
    '2026-10-31',
  );
  expect(archive).toMatchObject({ provider: 'QUESTRADE', ...parsed });
  expect(await api.statements(home.id, account.id)).toEqual([archive]);
  expect(await api.balances(home.id, account.id)).toMatchObject([
    { amount: '117.56', asOf: '2026-10-31T23:59:59.999Z' },
  ]);
  const downloaded = await api.downloadStatement(home.id, account.id, archive.id);
  expect(downloaded.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(questradeXlsx());
  await expect(
    api.importStatement(home.id, account.id, 'renamed.xlsx', workbook, '2026-11-01'),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await api.extractStatementInvestments(home.id, account.id, archive.id)).investments,
  ).toEqual(parsed.investments);
  expect(await api.balances(home.id, account.id)).toHaveLength(1);
  const other = await setup();
  await expect(api.downloadStatement(other.home.id, account.id, archive.id)).rejects.toMatchObject({
    status: 404,
  });
  const base = `/households/${home.id}/accounts/${account.id}/statements`;
  expect((await app.inject(`${base}/${archive.id}/pdf`)).statusCode).toBe(422);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base}/preview?filename=wrong.pdf`,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        payload: questradeXlsx(),
      })
    ).statusCode,
  ).toBe(422);
});

it('reports storage usage and rejects writes beyond the database size cap with 507', async () => {
  const limitBytes = 16 * 1024 * 1024;
  const small = await testDatabase(limitBytes);
  const smallApp = buildApp(small, false);
  try {
    const client = createApiClient(await smallApp.listen({ host: '127.0.0.1', port: 0 }));
    const before = await client.storage();
    expect(before.limitBytes).toBe(limitBytes);
    expect(before.usedBytes).toBeGreaterThan(0);
    const home = await client.createHousehold('Full home', 'CAD');
    const account = await client.addAccount(home.id, { name: 'Pension', type: 'INVESTMENT' });
    await small.driver.query('CREATE TABLE filler (data BLOB)', [], 'run');
    for (const size of [1024 * 1024, 4096, 64]) {
      for (;;) {
        try {
          await small.driver.query('INSERT INTO filler VALUES (randomblob(?))', [size], 'run');
        } catch (error) {
          expect(error).toBeInstanceOf(StorageLimitError);
          break;
        }
      }
    }
    const full = await client.storage();
    expect(full.usedBytes).toBeGreaterThan(limitBytes - 64 * 1024);
    expect(full.usedBytes).toBeLessThanOrEqual(limitBytes);
    // A trailing PDF comment makes the archive need new pages without changing its content.
    const padded = new Blob([new Uint8Array(sunLifePdf()), `\n%${'x'.repeat(65536)}\n`], {
      type: 'application/pdf',
    });
    expect(await client.previewStatement(home.id, account.id, 'big.pdf', padded)).toMatchObject({
      amount: '1234.56',
    });
    await expect(
      client.importStatement(home.id, account.id, 'big.pdf', padded),
    ).rejects.toMatchObject({
      status: 507,
      message: 'Storage limit of 16 MiB reached.',
    });
    expect(await client.statements(home.id, account.id)).toEqual([]);
    expect(await client.balances(home.id, account.id)).toEqual([]);
  } finally {
    await smallApp.close();
    await small.close();
  }
});
