<script lang="ts">
  import { Alert, Button, Card, Form, Input, Label, Spinner } from '@sveltestrap/sveltestrap';
  import type { Account, ExpenseCategory, Member, Overview, InvestmentMarket } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { formatMoney } from '../lib/money';
  import {
    chartColor,
    householdTrends,
    monthLabel,
    netChange,
    netWorthProjection,
    investmentProjection,
  } from '../lib/overview';
  import { cents } from '../lib/money';
  import TimeChart, { type ChartSeries } from './TimeChart.svelte';
  import DonutChart from './DonutChart.svelte';

  let {
    householdId,
    defaultCurrency,
    accounts,
    members,
    revision,
  }: {
    householdId: string;
    defaultCurrency: string;
    accounts: Account[];
    members: Member[];
    revision: number;
  } = $props();

  let data = $state<Overview | null>(null);
  let categories = $state<ExpenseCategory[]>([]);
  let loading = $state(true);
  let error = $state('');
  let retry = $state(0);
  let range = $state(12);
  let selectedCurrency = $state('');
  let forecastMonths = $state(12);
  let forecastMode = $state('automatic');
  let monthlyAssumption = $state('0.00');
  let assumptionInput = $state('0.00');
  let annualReturn = $state(5);
  let returnInput = $state<number | undefined>(5);
  let contribution = $state('0.00');
  let contributionInput = $state('0.00');
  let market = $state<InvestmentMarket | null>(null);
  let marketBusy = $state(false);
  let marketError = $state('');
  let marketApplied = $state(false);
  let marketController: AbortController | undefined;
  const today = new Date().toISOString().slice(0, 10);
  let through = $state(today);
  let throughInput = $state(today);
  const currencies = $derived(
    [
      ...new Set([
        defaultCurrency,
        ...accounts.map((account) => account.currency),
        ...(data?.expenses.map((expense) => expense.currency) ?? []),
        ...(data?.income.map((entry) => entry.currency) ?? []),
      ]),
    ].sort(),
  );
  const currency = $derived(
    currencies.includes(selectedCurrency) ? selectedCurrency : defaultCurrency,
  );
  const projectionReturn = $derived(
    marketApplied && market?.annualReturn !== null && market?.annualReturn !== undefined
      ? market.annualReturn
      : annualReturn,
  );
  $effect(() => {
    void householdId;
    void currency;
    void through;
    void revision;
    market = null;
    marketError = '';
    marketApplied = false;
    marketBusy = false;
    return () => marketController?.abort();
  });
  async function loadMarket() {
    marketController?.abort();
    const controller = new AbortController();
    marketController = controller;
    marketBusy = true;
    marketError = '';
    marketApplied = false;
    market = null;
    try {
      const result = await api.investmentMarket(householdId, through, currency, controller.signal);
      if (controller.signal.aborted) return;
      market = result;
      marketApplied = result.annualReturn !== null;
      if (!marketApplied)
        marketError =
          'No usable weighted market return was found. The manual growth assumption remains in use; review the holdings below.';
    } catch (cause) {
      if (!controller.signal.aborted) marketError = errorMessage(cause);
    } finally {
      if (!controller.signal.aborted) marketBusy = false;
    }
  }
  const investmentForecast = $derived(
    data
      ? investmentProjection(
          data,
          accounts,
          currency,
          forecastMonths,
          projectionReturn,
          cents(contribution),
        )
      : null,
  );
  const forecast = $derived(
    data
      ? netWorthProjection(
          data,
          accounts,
          currency,
          forecastMonths,
          forecastMode === 'manual' ? cents(monthlyAssumption) : undefined,
        )
      : null,
  );
  const trends = $derived(
    data ? householdTrends(data, accounts, members, categories, currency) : null,
  );
  const offset = $derived(Math.max(0, (data?.months.length ?? 0) - range));
  const points = $derived(trends?.points.slice(offset) ?? []);
  const labels = $derived(points.map((point) => monthLabel(point.month)));
  const latest = $derived(trends?.points.at(-1));
  const known = $derived(points.some((point) => point.net !== null));
  const number = (value: bigint | null) => (value === null ? null : Number(value));
  const money = (value: bigint) => formatMoney(value, currency);
  const netSeries = $derived<ChartSeries[]>([
    {
      key: 'net',
      label: 'Household net worth',
      color: '#1d6251',
      area: true,
      values: points.map((point) => number(point.net)),
    },
    {
      key: 'assets',
      label: 'Assets',
      color: '#2b6cb0',
      values: points.map((point) => number(point.assets)),
    },
    {
      key: 'debts',
      label: 'Debts',
      color: '#c0392b',
      dashed: true,
      values: points.map((point) => number(point.debts)),
    },
  ]);
  const netForecast = $derived(
    forecast
      ? {
          ...forecast,
          points: forecast.points.map((point, index) => ({
            ...point,
            net: point.net + (investmentForecast?.points[index]?.gains ?? 0n),
          })),
        }
      : null,
  );
  const netLabels = $derived([
    ...labels,
    ...(forecast?.points.slice(1).map((point) => `${monthLabel(point.month)} (projected)`) ?? []),
  ]);
  const projectedSeries = $derived<ChartSeries[]>([
    ...netSeries.map((series) => ({
      ...series,
      values: [...series.values, ...(forecast?.points.slice(1).map(() => null) ?? [])],
    })),
    ...(forecast
      ? [
          {
            key: 'forecast',
            label: 'Projected net worth',
            color: '#8556a5',
            dashed: true,
            values: [
              ...points.slice(0, -1).map(() => null),
              ...netForecast!.points.map((point) => Number(point.net)),
            ],
          },
        ]
      : []),
  ]);
  const growth = $derived.by(() => {
    if (!trends || !data) return [];
    const last = trends.points.length - 1;
    const year = Number(data.months[last]!.slice(0, 4));
    const december = data.months.indexOf(`${year - 1}-12`);
    return [
      { label: 'Month-to-date change', change: netChange(trends.points, last - 1) },
      { label: 'Year-to-date change', change: netChange(trends.points, december) },
      { label: '12-month change', change: netChange(trends.points, last - 12) },
    ];
  });
  const spending = $derived(
    trends?.spending.map((item, index) => ({
      key: item.key,
      label: item.label,
      color: chartColor(index),
      values: item.values.slice(offset).map(Number),
    })) ?? [],
  );
  const spendingTotal = $derived(
    trends?.spending.reduce(
      (sum, item) => sum + item.values.slice(offset).reduce((a, b) => a + b, 0n),
      0n,
    ) ?? 0n,
  );
  const cashflow = $derived(trends?.cashflow.slice(offset) ?? []);
  const hasCashflow = $derived(
    data &&
      [...data.income, ...data.expenses].some(
        (entry) =>
          entry.currency === currency && points.some((point) => point.month === entry.month),
      ),
  );
  const incomeTotal = $derived(cashflow.reduce((sum, point) => sum + point.income, 0n));
  const cashSeries = $derived<ChartSeries[]>([
    {
      key: 'income',
      label: 'Income',
      color: '#1d6251',
      values: cashflow.map((point) => Number(point.income)),
    },
    {
      key: 'expenses',
      label: 'Expenses less refunds',
      color: '#c0392b',
      values: cashflow.map((point) => Number(point.expenses)),
    },
    {
      key: 'surplus',
      label: 'Recorded surplus',
      color: '#2b6cb0',
      dashed: true,
      values: cashflow.map((point) => Number(point.net)),
    },
  ]);

  $effect(() => {
    const id = householdId;
    const asOf = through;
    void revision;
    void retry;
    const controller = new AbortController();
    loading = true;
    error = '';
    data = null;
    void Promise.all([
      api.overview(id, 37, asOf, controller.signal),
      api.expenseCategories(id, controller.signal),
    ])
      .then(([overview, nextCategories]) => {
        if (controller.signal.aborted) return;
        data = overview;
        categories = nextCategories;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) error = errorMessage(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });
</script>

<section class="trends-section" aria-label="Household trends">
  <div class="section-heading">
    <div>
      <div class="eyebrow">The bigger picture</div>
      <h2>Household trends</h2>
      <p class="muted small">Everyone's accounts, together with shared household accounts.</p>
    </div>
    <div class="trends-controls">
      <div class="range-group" role="group" aria-label="Chart time range">
        {#each [6, 12, 24, 36] as months}
          <button type="button" aria-pressed={range === months} onclick={() => (range = months)}
            >{months}M</button
          >
        {/each}
      </div>
      <select
        class="form-select form-select-sm"
        aria-label="Chart currency"
        bind:value={selectedCurrency}
        onchange={() => {
          forecastMode = 'automatic';
          contribution = '0.00';
          contributionInput = '0.00';
        }}
      >
        <option value="">{defaultCurrency}</option>
        {#each currencies.filter((code) => code !== defaultCurrency) as code}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </div>
  </div>
  <Form
    class="d-flex flex-wrap gap-2 align-items-end mb-3"
    on:submit={(event: SubmitEvent) => {
      event.preventDefault();
      through = throughInput;
    }}
  >
    <div>
      <Label for="history-through">History through</Label><Input
        id="history-through"
        type="date"
        min="1003-01-01"
        max="9999-12-31"
        required
        bind:value={throughInput}
      />
    </div>
    <Button color="primary" outline type="submit" disabled={loading}>Apply date</Button>
  </Form>
  {#if loading}
    <Card
      ><p role="status" class="muted mb-0">
        <Spinner size="sm" class="me-2" />Loading household history...
      </p></Card
    >
  {:else if error}
    <Alert color="danger" fade={false}>
      Could not load household charts. {error}
      <Button color="link" on:click={() => retry++}>Retry charts</Button>
    </Alert>
  {:else if trends && data}
    <div class="kpi-grid">
      {#each growth as item}
        <div class="kpi">
          <div class="eyebrow">{item.label}</div>
          <strong
            class:up={item.change && item.change.amount > 0n}
            class:down={item.change && item.change.amount < 0n}
          >
            {item.change
              ? `${item.change.amount > 0n ? '+' : ''}${money(item.change.amount)}`
              : 'Not enough history'}
          </strong>
          <span class="muted small"
            >{item.change?.percent != null
              ? `${item.change.percent > 0 ? '+' : ''}${item.change.percent.toFixed(1)}% recorded net worth`
              : 'Same-account balance comparison'}</span
          >
        </div>
      {/each}
    </div>
    <p class="muted small">
      Month-end observations carried forward until updated; the last month stops at {through} (UTC). Balance
      changes include deposits, withdrawals and debt payments, not just returns. Growth is unavailable
      when the observed account set changes. No currency conversion.
    </p>
    {#if latest?.missing}
      <Alert color="warning" fade={false}
        >{latest.missing}
        {currency} account(s) have no observation as of {through} and are excluded from charts.</Alert
      >
    {/if}
    <div class="chart-grid">
      <Card class="chart-card wide">
        <h3>Income and expenses over time</h3>
        <p class="muted small chart-intro">
          {money(incomeTotal)} income, {money(spendingTotal)} expenses less refunds,
          {money(incomeTotal - spendingTotal)} recorded surplus over {range} months. All household members
          combined. Unrecorded activity is not inferred; this is cash-flow history, not net-worth growth.
        </p>
        {#if hasCashflow}
          <TimeChart
            {labels}
            {currency}
            series={cashSeries}
            ariaLabel="Household income and expenses by month"
            caption="Recorded receipts, spending and surplus; last month is incomplete"
          />
          <details class="chart-data">
            <summary>View monthly cash flow</summary>
            <div class="table-responsive">
              <table class="table table-sm">
                <thead
                  ><tr
                    ><th scope="col">Month</th><th scope="col">Income</th><th scope="col"
                      >Expenses less refunds</th
                    ><th scope="col">Surplus</th></tr
                  ></thead
                >
                <tbody
                  >{#each cashflow as point}<tr
                      ><th scope="row">{monthLabel(point.month)}</th><td>{money(point.income)}</td
                      ><td>{money(point.expenses)}</td><td>{money(point.net)}</td></tr
                    >{/each}</tbody
                >
              </table>
            </div>
          </details>
        {:else}<p class="muted">
            Import a historical budget or record income and expenses to see cash flow.
          </p>{/if}
      </Card>
      <Card class="chart-card wide">
        <h3>Household net worth over time</h3>
        <p class="muted small chart-intro">
          Combined assets minus credit, loan and mortgage balances. Property values are not added as
          assets.
        </p>
        {#if known}
          <div class="forecast-controls d-flex flex-wrap gap-3 align-items-end mb-3">
            <div>
              <Label for="forecast-horizon">Project ahead</Label>
              <select id="forecast-horizon" class="form-select" bind:value={forecastMonths}>
                {#each [12, 24, 36, 60] as months}<option value={months}>{months} months</option
                  >{/each}
              </select>
            </div>
            <div>
              <Label for="forecast-mode">Projection basis</Label>
              <select id="forecast-mode" class="form-select" bind:value={forecastMode}>
                <option value="automatic">Recent recorded cash flow</option>
                <option value="manual">Custom monthly change</option>
              </select>
            </div>
          </div>
          {#if forecastMode === 'manual'}
            <Form
              class="forecast-controls d-flex flex-wrap gap-2 align-items-end mb-3"
              on:submit={(event: SubmitEvent) => {
                event.preventDefault();
                monthlyAssumption = assumptionInput;
              }}
            >
              <div>
                <Label for="forecast-change">Monthly net-worth change ({currency})</Label>
                <Input
                  id="forecast-change"
                  type="text"
                  inputmode="decimal"
                  required
                  pattern={'-?(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'}
                  bind:value={assumptionInput}
                />
              </div>
              <Button type="submit" color="primary" outline>Apply assumption</Button>
            </Form>
          {/if}
          {#if forecast}
            {#if forecast.missingAccounts}
              <Alert color="warning" fade={false}>
                Partial net-worth projection: {forecast.missingAccounts}
                {currency} account(s) have no recorded balance as of {through}. Only known balances
                are projected; missing assets or debts are excluded, not assumed to be zero.
              </Alert>
            {/if}
            {#if !investmentForecast && accounts.some((account) => account.currency === currency && account.type === 'INVESTMENT')}
              <p class="muted small">
                Investment growth is not included: every {currency} investment account needs a non-negative
                recorded balance. The cash-flow projection still extends into the future.
              </p>
            {/if}
            <p class="muted small" role="status">
              Projection: {money(netForecast!.points.at(-1)!.net)} by {monthLabel(
                forecast.points.at(-1)!.month,
              )}, using {money(forecast.monthlyChange)} per month.
              {#if forecast.basis === 'cashflow'}
                Average recorded income less expenses across {forecast.sampleMonths.length} completed
                months with both income and expense records in the trailing 12-month window. Months without
                both are excluded; the selected through-month is excluded.
              {:else if forecast.basis === 'flat'}
                Fewer than three completed months have both income and expense records in the
                trailing 12 months. Cash-flow change is held at zero; investment growth assumptions
                below still apply.
              {:else}
                Uses your custom monthly change, not an estimated return.
              {/if}
              Starts from the latest recorded balances as of {through}; each future point adds one
              monthly change plus projected investment gains using the assumptions below.
              Contributions are transfers from household cash, not extra net worth. If your custom
              monthly change already includes investment returns, set the annual growth assumption
              to zero to avoid counting them twice. Assumes the same accounts and currency, with no
              inflation or separate mortgage amortization. Transfers, missing activity and principal
              payments in expenses can distort recorded surplus. This is a scenario, not a financial
              prediction.
            </p>
          {:else}
            <p class="muted small">
              Record at least one {currency} account balance to enable a projection.
            </p>
          {/if}
          <TimeChart
            labels={netLabels}
            axisLabels={[
              labels[0] ?? '',
              forecast ? monthLabel(forecast.points.at(-1)!.month) : (labels.at(-1) ?? ''),
            ]}
            series={projectedSeries}
            marker={points.length - 1}
            {currency}
            ariaLabel="Household net worth by month"
            caption="Hover, tap or use arrow keys for monthly values"
          />
          <details class="chart-data">
            <summary>View monthly values</summary>
            <div class="table-responsive">
              <table class="table table-sm">
                <caption class="visually-hidden">Recorded household balances in {currency}</caption>
                <thead
                  ><tr
                    ><th scope="col">Month</th><th scope="col">Assets</th><th scope="col">Debts</th
                    ><th scope="col">Net worth</th></tr
                  ></thead
                >
                <tbody>
                  {#each points as point}
                    <tr
                      ><th scope="row">{monthLabel(point.month)}</th>
                      <td>{point.assets === null ? 'No data' : money(point.assets)}</td>
                      <td>{point.debts === null ? 'No data' : money(point.debts)}</td>
                      <td>{point.net === null ? 'No data' : money(point.net)}</td></tr
                    >
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
          {#if forecast}
            <details class="chart-data">
              <summary>View projected values</summary>
              <div class="table-responsive">
                <table class="table table-sm">
                  <thead
                    ><tr><th scope="col">Month</th><th scope="col">Projected net worth</th></tr
                    ></thead
                  >
                  <tbody
                    >{#each netForecast!.points.slice(1) as point}
                      <tr
                        ><th scope="row">{monthLabel(point.month)}</th><td>{money(point.net)}</td
                        ></tr
                      >
                    {/each}</tbody
                  >
                </table>
              </div>
            </details>
          {/if}
        {:else}
          <p class="muted">
            Record a balance to start your household history. Missing observations are not zero
            balances.
          </p>
        {/if}
      </Card>
      <Card class="chart-card">
        <h3>Investment balances over time</h3>
        <p class="muted small chart-intro">
          TFSA, DCPP and all other investment plans, combined across members.
        </p>
        <Button color="primary" outline disabled={marketBusy} on:click={loadMarket}>
          {marketBusy ? 'Loading market history...' : 'Load market-based projection'}
        </Button>
        <p class="muted small mt-2">
          Fetches public stock/ETF history for explicit tickers in each account's latest imported
          statement as of {through}. Only tickers and dates leave the server, not balances, names or
          documents. CAD tickers without a recognized exchange suffix are tried on Toronto (.TO);
          verify the returned security name. No name-based fund matching.
        </p>
        {#if marketError}<Alert color="warning" fade={false}>{marketError}</Alert>{/if}
        {#if market}
          <p class="muted small">
            {market.source} · Retrieved {market.fetchedAt}. Matched {market.coveragePercent.toFixed(
              1,
            )}% of recorded investment balances.
            {#if market.annualReturn !== null}
              Weighted historical annual growth: {market.annualReturn.toFixed(2)}%.
              {marketApplied
                ? 'Applied to both investment and net-worth forecasts.'
                : 'Manual assumption currently applied.'}
            {/if}
            Uses up to five years of adjusted daily closes (minimum three years), not an expected return.
            Latest price is the last daily close available through the selected date (excluding today's
            incomplete session), not a live quote. Statement proportions are scaled to recorded account
            balances; holdings may have changed. Unmatched holdings, cash and currency-mismatched positions
            contribute zero assumed growth, not a fabricated market return. No FX conversion. Yahoo's
            unofficial API may be unavailable.
          </p>
          <div class="table-responsive">
            <table class="table table-sm" aria-label="Market holdings">
              <thead
                ><tr
                  ><th scope="col">Holding / ticker</th><th scope="col">Statement</th><th
                    scope="col">Projection weight</th
                  ><th scope="col">Last close</th><th scope="col">Historical annual return</th><th
                    scope="col">History / status</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each market.holdings as holding}
                  <tr>
                    <th scope="row" class="text-break"
                      >{holding.name}<br />{holding.symbol ??
                        'No ticker'}{#if holding.marketName}<br />{holding.marketName}{/if}</th
                    >
                    <td
                      >{accounts.find((account) => account.id === holding.accountId)?.name}<br
                      />{holding.statementDate ?? 'No statement'}</td
                    >
                    <td>{holding.weightPercent.toFixed(1)}%</td>
                    <td
                      >{holding.price === null
                        ? 'Unavailable'
                        : `${holding.priceCurrency} ${holding.price.toFixed(2)}`}<br
                      />{holding.priceDate ?? ''}</td
                    >
                    <td
                      >{holding.annualReturn === null
                        ? 'Unavailable'
                        : `${holding.annualReturn.toFixed(2)}%`}</td
                    >
                    <td>{holding.error ?? `${holding.historyStart} to ${holding.priceDate}`}</td>
                  </tr>
                {:else}
                  <tr
                    ><td colspan="6">No imported investment holdings found in this currency.</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <Form
          class="forecast-controls d-flex flex-wrap gap-2 align-items-end mb-3"
          on:submit={(event: SubmitEvent) => {
            event.preventDefault();
            if (returnInput === undefined) return;
            annualReturn = returnInput;
            contribution = contributionInput;
            marketApplied = false;
          }}
        >
          <div>
            <Label for="investment-return">Annual investment growth (%)</Label>
            <Input
              id="investment-return"
              type="number"
              min={-100}
              max={100}
              step={0.1}
              required
              bind:value={returnInput}
            />
          </div>
          <div>
            <Label for="investment-contribution">Monthly investment contribution ({currency})</Label
            >
            <Input
              id="investment-contribution"
              type="text"
              inputmode="decimal"
              required
              pattern={'(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'}
              bind:value={contributionInput}
            />
          </div>
          <Button type="submit" color="primary" outline>Apply investment assumptions</Button>
        </Form>
        <p class="muted small">
          {marketApplied ? 'Market-history scenario:' : 'Illustrative manual scenario:'}
          {projectionReturn.toFixed(2)}% effective annual growth, compounded monthly, plus {money(
            cents(contribution),
          )}
          contributed at each month-end. Uses the shared {forecastMonths}-month horizon above. Not
          inferred from your balances or guaranteed. No fees, taxes or inflation. Investment gains
          also feed the net-worth projection; contributions are household transfers. Assumptions are
          temporary and reset on reload.
        </p>
        {#if investmentForecast}
          <p class="muted small" role="status">
            Projected investments: {money(investmentForecast.points.at(-1)!.balance)} by
            {monthLabel(investmentForecast.points.at(-1)!.month)}, including
            {money(investmentForecast.points.at(-1)!.contributions)} future contributions and
            {money(investmentForecast.points.at(-1)!.gains)} projected growth.
          </p>
        {:else}
          <p class="muted small">
            Record non-negative balances for every {currency} investment account to enable investment
            projections.
          </p>
        {/if}
        {#if points.some((point) => point.investments !== null)}
          <TimeChart
            labels={[
              ...labels,
              ...(investmentForecast?.points
                .slice(1)
                .map((point) => `${monthLabel(point.month)} (projected)`) ?? []),
            ]}
            axisLabels={[
              labels[0] ?? '',
              investmentForecast
                ? monthLabel(investmentForecast.points.at(-1)!.month)
                : (labels.at(-1) ?? ''),
            ]}
            marker={points.length - 1}
            {currency}
            series={[
              {
                key: 'investments',
                label: 'Investments',
                color: '#2b6cb0',
                area: true,
                values: [
                  ...points.map((point) => number(point.investments)),
                  ...(investmentForecast?.points.slice(1).map(() => null) ?? []),
                ],
              },
              ...(investmentForecast
                ? [
                    {
                      key: 'projected-investments',
                      label: 'Projected investments',
                      color: '#8556a5',
                      dashed: true,
                      values: [
                        ...points.slice(0, -1).map(() => null),
                        ...investmentForecast.points.map((point) => Number(point.balance)),
                      ],
                    },
                  ]
                : []),
            ]}
            ariaLabel="Household investments by month"
            caption="Balances include contributions and withdrawals"
          />
          {#if investmentForecast}
            <details class="chart-data">
              <summary>View projected investments</summary>
              <div class="table-responsive">
                <table class="table table-sm">
                  <thead
                    ><tr
                      ><th scope="col">Month</th><th scope="col">Investments</th><th scope="col"
                        >Contributions</th
                      ><th scope="col">Growth</th></tr
                    ></thead
                  >
                  <tbody
                    >{#each investmentForecast.points.slice(1) as point}
                      <tr
                        ><th scope="row">{monthLabel(point.month)}</th><td
                          >{money(point.balance)}</td
                        ><td>{money(point.contributions)}</td><td>{money(point.gains)}</td></tr
                      >
                    {/each}</tbody
                  >
                </table>
              </div>
            </details>
          {/if}
        {:else}<p class="muted">
            Add an investment account and record a balance to see its history.
          </p>{/if}
      </Card>
      <Card class="chart-card">
        <h3>Asset allocation</h3>
        <p class="muted small chart-intro">
          Latest recorded positive asset balances by account type and investment plan. Debts and
          negative asset balances are excluded.
        </p>
        {#if trends.allocation.some((item) => item.value > 0n)}
          <DonutChart
            {currency}
            ariaLabel="Household asset allocation"
            centerLabel="Assets"
            items={trends.allocation.map((item, index) => ({
              ...item,
              value: Number(item.value),
              color: chartColor(index),
            }))}
          />
        {:else}<p class="muted">No positive asset balances recorded yet.</p>{/if}
      </Card>
      <Card class="chart-card wide">
        <h3>Monthly household spending</h3>
        <p class="muted small chart-intro">
          {money(spendingTotal)} recorded over the selected {range} months, across all members and shared
          expenses. No expenses recorded means zero recorded spending, not necessarily zero actual spending.
        </p>
        {#if spending.length}
          <TimeChart
            {labels}
            {currency}
            mode="bars"
            series={spending}
            ariaLabel="Household spending by month"
            caption="Stacked by category; last month is incomplete"
            totalLabel="Recorded spending"
          />
        {:else}<p class="muted">Add expenses for this period to see spending trends.</p>{/if}
      </Card>
      <Card class="chart-card">
        <h3>Net worth by household member</h3>
        <p class="muted small chart-intro">
          Latest recorded assets minus debts. Shared accounts are counted once, not split between
          members.
        </p>
        {#if trends.owners.length}
          <TimeChart
            labels={trends.owners.map((owner) => owner.label)}
            {currency}
            mode="bars"
            series={[
              {
                key: 'owners',
                label: 'Net worth',
                color: '#1d6251',
                values: trends.owners.map((owner) => Number(owner.value)),
              },
            ]}
            ariaLabel="Net worth by household member"
            categoryAxis
            caption="Hover, tap or use arrow keys for member values"
            totalLabel="Net worth"
          />
        {:else}<p class="muted">No balances recorded for household members yet.</p>{/if}
      </Card>
      <Card class="chart-card">
        <h3>Spending breakdown</h3>
        <p class="muted small chart-intro">
          Positive net spending by category over the selected {range} months. Refunds reduce each category;
          categories with zero or negative net spending are excluded from this ring.
        </p>
        {#if spending.some((item) => item.values.reduce((a, b) => a + b, 0) > 0)}
          <DonutChart
            {currency}
            ariaLabel="Household spending breakdown"
            centerLabel="Spending"
            items={spending.map((item) => ({
              ...item,
              value: item.values.reduce((a, b) => a + b, 0),
            }))}
          />
        {:else}<p class="muted">
            No positive net spending by category in this currency and period.
          </p>{/if}
      </Card>
    </div>
  {/if}
</section>
