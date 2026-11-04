<script lang="ts">
  import { Alert, Button, Form, Input, Label, Spinner } from '@sveltestrap/sveltestrap';
  import type { Account, Overview, InvestmentMarket } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { cents, formatMoney } from '../lib/money';
  import {
    accountProjection,
    householdTrends,
    investmentProjection,
    isDebt,
    monthLabel,
    netChange,
  } from '../lib/overview';
  import TimeChart, { type ChartSeries } from './TimeChart.svelte';

  let { account, revision }: { account: Account; revision: number } = $props();
  let data = $state<Overview | null>(null);
  let loading = $state(true);
  let error = $state('');
  let retry = $state(0);
  let range = $state(12);
  let horizon = $state(12);
  const today = new Date().toISOString().slice(0, 10);
  let through = $state(today);
  let dateInput = $state(today);
  let rate = $state(5);
  let rateInput = $state<number | undefined>(5);
  let change = $state('0.00');
  let changeInput = $state('0.00');
  let market = $state<InvestmentMarket | null>(null);
  let marketBusy = $state(false);
  let marketError = $state('');
  let marketApplied = $state(false);
  let marketController: AbortController | undefined;
  const investment = $derived(account.type === 'INVESTMENT');
  const debt = $derived(isDebt(account));
  const money = (value: bigint) => formatMoney(value, account.currency);
  const trends = $derived(data ? householdTrends(data, [account], [], [], account.currency) : null);
  const points = $derived(trends?.points.slice(-range) ?? []);
  const current = $derived(trends?.points.at(-1));
  const last = $derived((trends?.points.length ?? 1) - 1);
  const changes = $derived(
    trends
      ? [
          { label: 'Monthly net-worth impact', value: netChange(trends.points, last - 1) },
          { label: '12-month net-worth impact', value: netChange(trends.points, last - 12) },
        ]
      : [],
  );
  const effectiveRate = $derived(
    marketApplied && market?.annualReturn != null ? market.annualReturn : rate,
  );
  const investmentFuture = $derived(
    data && investment
      ? investmentProjection(
          data,
          [account],
          account.currency,
          horizon,
          effectiveRate,
          cents(change),
        )
      : null,
  );
  const future = $derived(
    investment
      ? (investmentFuture?.points ?? null)
      : data
        ? accountProjection(data, account, horizon, cents(change))
        : null,
  );
  const labels = $derived([
    ...points.map((point) => monthLabel(point.month)),
    ...(future?.slice(1).map((point) => `${monthLabel(point.month)} (projected)`) ?? []),
  ]);
  const series = $derived<ChartSeries[]>([
    {
      key: 'recorded',
      label: 'Recorded balance',
      color: '#1d6251',
      area: true,
      values: [
        ...points.map((point) => {
          const value = debt ? point.debts : point.assets;
          return value === null ? null : Number(value);
        }),
        ...(future?.slice(1).map(() => null) ?? []),
      ],
    },
    ...(future
      ? [
          {
            key: 'projected',
            label: 'Projected balance',
            color: '#8556a5',
            dashed: true,
            values: [
              ...points.slice(0, -1).map(() => null),
              ...future.map((point) => Number(point.balance)),
            ],
          },
        ]
      : []),
  ]);
  $effect(() => {
    const id = account.householdId;
    void account.id;
    void revision;
    void retry;
    const date = through;
    const controller = new AbortController();
    loading = true;
    error = '';
    data = null;
    market = null;
    marketApplied = false;
    marketError = '';
    marketBusy = false;
    void api
      .overview(id, 37, date, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) data = result;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) error = errorMessage(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => {
      controller.abort();
      marketController?.abort();
    };
  });
  async function loadMarket() {
    const controller = new AbortController();
    marketController?.abort();
    marketController = controller;
    marketBusy = true;
    marketError = '';
    marketApplied = false;
    market = null;
    try {
      const result = await api.investmentMarket(
        account.householdId,
        through,
        account.currency,
        controller.signal,
        account.id,
      );
      if (controller.signal.aborted) return;
      market = result;
      marketApplied = result.annualReturn !== null;
      if (!marketApplied)
        marketError = 'No usable market return for this account. Manual assumptions remain in use.';
    } catch (cause) {
      if (!controller.signal.aborted) marketError = errorMessage(cause);
    } finally {
      if (!controller.signal.aborted) marketBusy = false;
    }
  }
</script>

<section class="account-overview chart-card my-3" aria-label="Account overview">
  <h3>Account overview · {account.name}</h3>
  <p class="muted small">
    Only this account in {account.currency}. Month-end snapshots carry forward; missing observations
    remain unknown. Changes include deposits and withdrawals, not just returns. Scenarios do not
    save balances or change account records.
  </p>
  <Form
    class="forecast-controls d-flex flex-wrap gap-2 align-items-end mb-3"
    on:submit={(event: SubmitEvent) => {
      event.preventDefault();
      through = dateInput;
    }}
  >
    <div>
      <Label for="account-through">Account history through</Label>
      <Input
        id="account-through"
        type="date"
        min="1003-01-01"
        max="9999-12-31"
        required
        bind:value={dateInput}
      />
    </div>
    <Button color="primary" outline type="submit" disabled={loading}>Apply account date</Button>
  </Form>
  {#if loading}<p role="status"><Spinner size="sm" /> Loading account trends...</p>
  {:else if error}<Alert color="danger" fade={false}
      >{error}<Button color="link" on:click={() => retry++}>Retry account trends</Button></Alert
    >
  {:else if trends}
    <div class="kpi-grid">
      <div class="kpi">
        <div class="eyebrow">{debt ? 'Recorded amount owed' : 'Recorded balance'}</div>
        <strong
          >{current?.net == null
            ? 'No data'
            : money(debt ? current.debts! : current.assets!)}</strong
        ><span class="muted small">As of {through}; may be carried forward</span>
      </div>
      {#each changes as item}<div class="kpi">
          <div class="eyebrow">{item.label}</div>
          <strong
            >{item.value
              ? `${item.value.amount > 0n ? '+' : ''}${money(item.value.amount)}`
              : 'Not enough history'}</strong
          ><span class="muted small"
            >{item.value?.percent == null
              ? 'Same-account balance comparison'
              : `${item.value.percent.toFixed(1)}% net-worth impact`}</span
          >
        </div>{/each}
    </div>
    <div class="forecast-controls d-flex flex-wrap gap-3 mb-3">
      <div>
        <Label for="account-range">Account history range</Label><select
          id="account-range"
          class="form-select"
          bind:value={range}
          >{#each [6, 12, 24, 36] as months}<option value={months}>{months} months</option
            >{/each}</select
        >
      </div>
      <div>
        <Label for="account-horizon">Account projection horizon</Label><select
          id="account-horizon"
          class="form-select"
          bind:value={horizon}
          >{#each [12, 24, 36, 60] as months}<option value={months}>{months} months</option
            >{/each}</select
        >
      </div>
    </div>
    <Form
      class="forecast-controls d-flex flex-wrap gap-2 align-items-end mb-3"
      on:submit={(event: SubmitEvent) => {
        event.preventDefault();
        if (investment && rateInput !== undefined) rate = rateInput;
        change = changeInput;
        marketApplied = false;
      }}
    >
      {#if investment}<div>
          <Label for="account-rate">Account annual growth (%)</Label><Input
            id="account-rate"
            type="number"
            min={-100}
            max={100}
            step={0.1}
            required
            bind:value={rateInput}
          />
        </div>{/if}
      <div>
        <Label for="account-change"
          >{investment ? 'Account monthly contribution' : 'Account monthly balance change'} ({account.currency})</Label
        >
        <Input
          id="account-change"
          type="text"
          inputmode="decimal"
          required
          pattern={investment
            ? '(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'
            : '-?(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'}
          bind:value={changeInput}
        />
      </div>
      <Button color="primary" outline type="submit">Apply account assumptions</Button>
    </Form>
    {#if investment}
      <Button color="primary" outline disabled={marketBusy} on:click={loadMarket}
        >{marketBusy
          ? 'Loading account market history...'
          : 'Load account market projection'}</Button
      >
      <p class="muted small mt-2">
        Explicitly sends only tickers/dates from this account's latest statement to Yahoo's
        unofficial public API. CAD bare tickers default to Toronto; verify returned identities.
        Historical adjusted returns are not predictions. Unmatched holdings and cash receive zero
        assumed growth. No FX conversion.
      </p>
      {#if marketError}<Alert color="warning" fade={false}>{marketError}</Alert>{/if}
      {#if market}
        <p class="muted small">
          {market.source} · Retrieved {market.fetchedAt} · {market.coveragePercent.toFixed(1)}%
          account coverage.
        </p>
        <div class="table-responsive">
          <table class="table table-sm" aria-label="Account market holdings">
            <thead
              ><tr
                ><th scope="col">Holding / ticker</th><th scope="col">Statement</th><th scope="col"
                  >Weight</th
                ><th scope="col">Last close</th><th scope="col">Historical annual return</th><th
                  scope="col">History / status</th
                ></tr
              ></thead
            >
            <tbody
              >{#each market.holdings as holding}<tr
                  ><th scope="row"
                    >{holding.symbol ?? 'No ticker'} · {holding.marketName ?? holding.name}</th
                  ><td>{holding.statementDate}</td><td>{holding.weightPercent.toFixed(1)}%</td><td
                    >{holding.price === null
                      ? 'Unavailable'
                      : `${holding.priceCurrency} ${holding.price.toFixed(2)}`}<br
                    />{holding.priceDate}</td
                  ><td
                    >{holding.annualReturn === null
                      ? 'Unavailable'
                      : `${holding.annualReturn.toFixed(2)}%`}</td
                  ><td>{holding.error ?? `${holding.historyStart} to ${holding.priceDate}`}</td></tr
                >{:else}<tr><td colspan="6">No statement holdings found.</td></tr>{/each}</tbody
            >
          </table>
        </div>
      {/if}
      <p class="muted small">
        {marketApplied ? 'Market-history' : 'Illustrative manual'} scenario: {effectiveRate.toFixed(
          2,
        )}% effective annual growth, compounded monthly;
        {money(cents(change))} contributed at month-end. Default 5% is illustrative, not inferred. No
        fees, taxes or inflation. Assumptions reset when the account view closes.
      </p>
    {:else}
      <p class="muted small">
        Adds {money(cents(change))} to the balance each month.
        {debt
          ? 'Negative changes repay debt; repayment stops at zero. Positive changes increase debt.'
          : 'Positive changes add funds; negative changes withdraw funds.'}
        This is a linear scenario, not inferred cash flow or interest.
        {#if account.type === 'MORTGAGE'}Use the mortgage schedule below for interest, payments and
          prepayment-aware amortization.{/if}
      </p>
    {/if}
    {#if future}<p class="muted small" role="status">
        Projected account balance: {money(future.at(-1)!.balance)} by {monthLabel(
          future.at(-1)!.month,
        )}.
      </p>{:else}<p class="muted">
        Record a balance as of this date to enable projections. Investment projections require a
        non-negative balance.
      </p>{/if}
    <TimeChart
      {labels}
      {series}
      currency={account.currency}
      marker={points.length - 1}
      axisLabels={[
        points[0] ? monthLabel(points[0].month) : '',
        future
          ? monthLabel(future.at(-1)!.month)
          : points.at(-1)
            ? monthLabel(points.at(-1)!.month)
            : '',
      ]}
      ariaLabel="Account balance history and projection"
      caption="Recorded history and dashed scenario; hover, tap or use arrow keys"
    />
    <details class="chart-data">
      <summary>View account monthly history</summary>
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th scope="col">Month</th><th scope="col">Recorded balance</th></tr></thead
          ><tbody
            >{#each points as point}<tr
                ><th scope="row">{monthLabel(point.month)}</th><td
                  >{point.net === null ? 'No data' : money(debt ? point.debts! : point.assets!)}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
    </details>
    {#if future}<details class="chart-data">
        <summary>View account projected values</summary>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead><tr><th scope="col">Month</th><th scope="col">Projected balance</th></tr></thead
            ><tbody
              >{#each future.slice(1) as point}<tr
                  ><th scope="row">{monthLabel(point.month)}</th><td>{money(point.balance)}</td></tr
                >{/each}</tbody
            >
          </table>
        </div>
      </details>{/if}
  {/if}
</section>
