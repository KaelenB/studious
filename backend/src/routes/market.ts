import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  investmentMarketQuery,
  investmentMarketSchema,
  type InvestmentMarket,
} from '@studious/api';
import type { Database } from '../db/database.js';
import { accounts, statementArchives } from '../models/schema.js';
import { householdScope, requestHousehold } from '../middleware/household.js';
import type { FinanceService } from '../services/finance.js';
import { createOverviewRepository } from '../repositories/overview.js';
import { createMarketHistory } from '../services/market.js';
import { ApplicationError } from '../services/errors.js';

export function registerMarketRoutes(
  app: FastifyInstance,
  db: Database,
  finance: FinanceService,
  transport: typeof fetch = fetch,
) {
  const history = createMarketHistory(transport);
  let busy = false;
  app.register(
    async (scoped) => {
      scoped.decorateRequest('household', null);
      scoped.addHook('preHandler', householdScope(finance));
      scoped.get('/investment-market', async (request, reply) => {
        const { asOf, currency, accountId } = investmentMarketQuery.parse(request.query);
        if (asOf > new Date().toISOString().slice(0, 10))
          throw new ApplicationError(
            'INVALID',
            'Market history cannot be requested for a future date.',
          );
        if (busy) {
          request.log.warn('Market lookup already in progress');
          return reply
            .code(503)
            .send({ error: 'A market lookup is already in progress. Try again shortly.' });
        }
        busy = true;
        try {
          const householdId = requestHousehold(request).id;
          const selected = await db
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.householdId, householdId),
                eq(accounts.currency, currency),
                eq(accounts.type, 'INVESTMENT'),
                isNull(accounts.deletedAt),
                accountId ? eq(accounts.id, accountId) : undefined,
              ),
            );
          if (accountId && !selected.length)
            throw new ApplicationError(
              'NOT_FOUND',
              'Investment account not found in this household and currency.',
            );
          const cutoff = new Date(`${asOf}T00:00:00Z`);
          cutoff.setUTCDate(cutoff.getUTCDate() + 1);
          const balances = await createOverviewRepository(db).latestBalancesBefore(
            householdId,
            cutoff,
          );
          const amounts = new Map(
            balances.map((row) => [row.accountId, Math.max(0, Number(row.amount))]),
          );
          const total = selected.reduce((sum, account) => sum + (amounts.get(account.id) ?? 0), 0);
          const holdings: InvestmentMarket['holdings'] = [];
          let lookups = 0;
          for (const account of selected) {
            const [statement] = await db
              .select({
                investments: statementArchives.investments,
                statementDate: statementArchives.statementDate,
                amount: statementArchives.amount,
              })
              .from(statementArchives)
              .where(
                and(
                  eq(statementArchives.householdId, householdId),
                  eq(statementArchives.accountId, account.id),
                  lte(statementArchives.statementDate, asOf),
                ),
              )
              .orderBy(
                desc(statementArchives.statementDate),
                desc(statementArchives.createdAt),
                desc(statementArchives.id),
              )
              .limit(1);
            const entries = statement?.investments?.length
              ? statement.investments
              : [
                  {
                    name: account.name,
                    value: '0.00',
                    symbol: undefined,
                    currency: undefined,
                  },
                ];
            const accountWeight = total ? (amounts.get(account.id) ?? 0) / total : 0;
            // Use statement proportions rather than treating historical units as current positions.
            const sameCurrencyTotal = entries
              .filter((entry) => (entry.currency ?? currency) === currency)
              .reduce((sum, entry) => sum + Number(entry.value), 0);
            const denominator = Math.max(Number(statement?.amount ?? 0), sameCurrencyTotal);
            for (const entry of entries) {
              const native = entry.currency ?? currency;
              const rawSymbol = entry.symbol?.trim().toUpperCase();
              const symbol = rawSymbol
                ? native === 'CAD' && !/\.(TO|V|NE|CN)$/.test(rawSymbol)
                  ? `${rawSymbol}.TO`
                  : rawSymbol
                : null;
              const weight =
                native === currency && denominator > 0
                  ? (accountWeight * Number(entry.value)) / denominator
                  : 0;
              const row: InvestmentMarket['holdings'][number] = {
                accountId: account.id,
                name: entry.name,
                symbol,
                statementDate: statement?.statementDate ?? null,
                weightPercent: weight * 100,
                marketName: null,
                price: null,
                priceCurrency: null,
                priceDate: null,
                historyStart: null,
                annualReturn: null,
                error: null,
              };
              if (!symbol)
                row.error =
                  'No explicit stock/ETF ticker in the latest statement; not guessed from the fund name.';
              else if (lookups >= 20) row.error = 'Market lookup limit of 20 holdings reached.';
              else {
                lookups++;
                try {
                  Object.assign(row, await history(symbol, native, asOf));
                  if (native !== currency)
                    row.error =
                      'Native currency differs from the projection currency; price shown but excluded from the weighted return (no FX return assumption).';
                } catch (error) {
                  row.error = error instanceof Error ? error.message : 'Market lookup failed.';
                  request.log.warn({ symbol, err: error }, 'Holding market history unavailable');
                }
              }
              holdings.push(row);
            }
          }
          const matched = holdings.filter((row) => row.annualReturn !== null);
          const coveragePercent = Math.min(
            100,
            matched.reduce((sum, row) => sum + row.weightPercent, 0),
          );
          const estimate = matched.reduce(
            (sum, row) => sum + (row.annualReturn! * row.weightPercent) / 100,
            0,
          );
          const annualReturn =
            coveragePercent > 0 && estimate >= -100 && estimate <= 100 ? estimate : null;
          return reply.header('Cache-Control', 'no-store').send(
            investmentMarketSchema.parse({
              source: 'Yahoo Finance (unofficial public API)',
              fetchedAt: new Date().toISOString(),
              asOf,
              currency,
              annualReturn,
              coveragePercent,
              holdings,
            }),
          );
        } finally {
          busy = false;
        }
      });
    },
    { prefix: '/households/:householdId' },
  );
}
