<script lang="ts">
  import { Alert, Button, Card, Form, Input, Label, Spinner } from '@sveltestrap/sveltestrap';
  import type { Account, ExpenseCategory, Member, Overview } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { formatMoney } from '../lib/money';
  import { chartColor, householdTrends, monthLabel, netChange } from '../lib/overview';
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
          <TimeChart
            {labels}
            series={netSeries}
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
        {#if points.some((point) => point.investments !== null)}
          <TimeChart
            {labels}
            {currency}
            series={[
              {
                key: 'investments',
                label: 'Investments',
                color: '#2b6cb0',
                area: true,
                values: points.map((point) => number(point.investments)),
              },
            ]}
            ariaLabel="Household investments by month"
            caption="Balances include contributions and withdrawals"
          />
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
