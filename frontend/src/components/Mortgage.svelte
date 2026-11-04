<script lang="ts">
  import {
    Alert,
    Button,
    Col,
    Form,
    Input,
    Label,
    Row,
    Spinner,
    Table,
  } from '@sveltestrap/sveltestrap';
  import {
    api,
    durationLabel,
    errorMessage,
    moneyPattern,
    paymentFrequencyLabels,
    rateTypeLabels,
    type Account,
    type Mortgage,
    type MortgageTermsInput,
  } from '../lib/api';
  import { cents, formatMoney, localDateTime } from '../lib/money';
  import MortgageChart from './MortgageChart.svelte';
  import MortgageTermsForm from './MortgageTermsForm.svelte';

  let {
    account,
    disabled,
    onrecord,
  }: {
    account: Account;
    disabled: boolean;
    onrecord: (amount: string, asOf: string) => Promise<void>;
  } = $props();
  let mortgage = $state<Mortgage | null>(null);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let editing = $state(false);
  let busy = $state(false);
  let version = $state(0);
  let amount = $state('');
  let date = $state(localDateTime().slice(0, 10));
  let note = $state('');

  const money = (value: string) => formatMoney(cents(value), account.currency);
  const day = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  $effect(() => {
    const householdId = account.householdId;
    const accountId = account.id;
    version;
    const controller = new AbortController();
    loading = true;
    error = '';
    api
      .mortgage(householdId, accountId, localDateTime().slice(0, 10), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) mortgage = result;
      })
      .catch((cause) => {
        if (!controller.signal.aborted) error = errorMessage(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  const terms = $derived(mortgage?.terms ?? null);
  const projection = $derived(mortgage?.projection ?? null);
  const prepayments = $derived(mortgage?.prepayments ?? []);

  async function saveTerms(input: MortgageTermsInput) {
    mortgage = await api.saveMortgageTerms(account.householdId, account.id, input);
    editing = false;
    notice = 'Mortgage terms saved.';
    version++;
  }

  async function addPrepayment(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    if (!moneyPattern.test(amount) || amount.startsWith('-')) {
      error = 'Enter a positive prepayment with exactly two decimal places.';
      return;
    }
    busy = true;
    try {
      await api.addPrepayment(account.householdId, account.id, {
        amount,
        date,
        note: note.trim() || null,
      });
      amount = '';
      note = '';
      notice = 'Prepayment added.';
      version++;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function removePrepayment(id: string) {
    busy = true;
    error = '';
    notice = '';
    try {
      await api.deletePrepayment(account.householdId, account.id, id);
      notice = 'Prepayment removed.';
      version++;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function recordProjected() {
    if (!projection) return;
    busy = true;
    error = '';
    notice = '';
    try {
      await onrecord(projection.balance, new Date().toISOString());
      notice = `Recorded the projected balance of ${money(projection.balance)}.`;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section class="mortgage" aria-label="Mortgage">
  <div class="section-heading history-heading">
    <h3>Mortgage</h3>
    {#if terms && !editing}
      <div class="mortgage-actions">
        <Button
          color="primary"
          outline
          size="sm"
          disabled={disabled || busy}
          on:click={() => (editing = true)}>Edit terms</Button
        >
        <Button
          color="primary"
          size="sm"
          disabled={disabled || busy || !projection}
          on:click={recordProjected}>Record projected balance</Button
        >
      </div>
    {/if}
  </div>
  {#if error}<Alert color="danger" fade={false}>
      {error}
      <Button color="link" on:click={() => version++}>Retry</Button>
    </Alert>{/if}
  {#if notice}<Alert color="success" fade={false}>{notice}</Alert>{/if}
  {#if loading && !mortgage}<p role="status">
      <Spinner size="sm" class="me-2" />Loading mortgage...
    </p>
  {:else if mortgage && (!terms || editing)}
    <MortgageTermsForm
      {terms}
      currency={account.currency}
      onsave={saveTerms}
      oncancel={terms ? () => (editing = false) : undefined}
    />
  {:else if terms && projection}
    <p class="muted small">
      {rateTypeLabels[terms.rateType]}
      {terms.annualRate}% &middot; {durationLabel(terms.amortizationMonths)} amortization &middot; {durationLabel(
        terms.termMonths,
      )} term from {day(terms.startDate)}
    </p>
    <div class="mortgage-grid">
      <div class="mortgage-stat">
        <span class="eyebrow">{paymentFrequencyLabels[terms.paymentFrequency]} payment</span>
        <strong>{money(projection.payment)}</strong>
        {#if projection.payment !== projection.calculatedPayment}<span class="muted small"
            >Calculated {money(projection.calculatedPayment)}</span
          >{/if}
      </div>
      <div class="mortgage-stat">
        <span class="eyebrow">Balance today</span>
        <strong>{money(projection.balance)}</strong>
        <span class="muted small">{money(projection.principalPaid)} principal repaid</span>
      </div>
      {#if projection.equity}
        <div class="mortgage-stat">
          <span class="eyebrow">Home equity</span>
          <strong>{money(projection.equity)}</strong>
          <span class="muted small"
            >{Math.round((Number(projection.equity) / Number(terms.propertyValue)) * 100)}% of {money(
              terms.propertyValue!,
            )}</span
          >
        </div>
      {/if}
      <div class="mortgage-stat">
        <span class="eyebrow">Next payment</span>
        {#if projection.nextPayment}
          <strong>{day(projection.nextPayment.date)}</strong>
          <span class="muted small"
            >{money(projection.nextPayment.interest)} interest &middot; {money(
              projection.nextPayment.principal,
            )} principal</span
          >
        {:else}<strong>Paid off</strong>{/if}
      </div>
      <div class="mortgage-stat">
        <span class="eyebrow">Renewal</span>
        <strong>{day(projection.termEndDate)}</strong>
        <span class="muted small">{money(projection.balanceAtTermEnd)} left at renewal</span>
      </div>
      <div class="mortgage-stat">
        <span class="eyebrow">Mortgage-free</span>
        <strong>{day(projection.payoffDate)}</strong>
        <span class="muted small">{projection.paymentsRemaining} payments remaining</span>
      </div>
      <div class="mortgage-stat">
        <span class="eyebrow">Lifetime interest</span>
        <strong>{money(projection.totalInterest)}</strong>
        <span class="muted small">{money(projection.interestPaid)} paid so far</span>
      </div>
      {#if cents(projection.interestSaved) > 0n}
        <div class="mortgage-stat">
          <span class="eyebrow">Saved by prepaying</span>
          <strong class="accent">{money(projection.interestSaved)}</strong>
          <span class="muted small">Without prepayments: {day(projection.baseline.payoffDate)}</span
          >
        </div>
      {/if}
    </div>
    <MortgageChart {terms} {projection} currency={account.currency} />

    <h4 class="mortgage-subheading">Prepayments</h4>
    <p class="muted small">
      Record lump sums you have made or plan to make. They are applied with the next regular payment
      and shorten the amortization.
    </p>
    {#if prepayments.length}
      <Table responsive size="sm">
        <thead
          ><tr
            ><th>Date</th><th class="numeric">Amount</th><th>Note</th><th
              ><span class="visually-hidden">Actions</span></th
            ></tr
          ></thead
        >
        <tbody>
          {#each prepayments as prepayment (prepayment.id)}
            <tr>
              <td>{day(prepayment.date)}</td>
              <td class="numeric">{money(prepayment.amount)}</td>
              <td>{prepayment.note ?? ''}</td>
              <td class="numeric"
                ><Button
                  color="link"
                  size="sm"
                  class="text-danger"
                  disabled={disabled || busy}
                  aria-label={`Remove ${money(prepayment.amount)} prepayment on ${day(prepayment.date)}`}
                  on:click={() => removePrepayment(prepayment.id)}>Remove</Button
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </Table>
    {/if}
    <Form on:submit={addPrepayment} aria-label="Add prepayment">
      <Row class="g-3 mb-3 align-items-end">
        <Col md="3">
          <Label for="prepayment-amount">Amount ({account.currency})</Label><Input
            id="prepayment-amount"
            inputmode="decimal"
            required
            bind:value={amount}
            placeholder="10000.00"
          />
        </Col>
        <Col md="3">
          <Label for="prepayment-date">Date</Label><Input
            id="prepayment-date"
            type="date"
            required
            min={terms.startDate}
            bind:value={date}
          />
        </Col>
        <Col md="4">
          <Label for="prepayment-note">Note (optional)</Label><Input
            id="prepayment-note"
            maxlength={200}
            bind:value={note}
            placeholder="Annual bonus"
          />
        </Col>
        <Col md="2">
          <Button type="submit" color="primary" outline disabled={disabled || busy}>Add</Button>
        </Col>
      </Row>
    </Form>

    <details class="mortgage-schedule">
      <summary>Yearly amortization schedule</summary>
      <Table responsive size="sm">
        <thead
          ><tr
            ><th>Year</th><th class="numeric">Interest</th><th class="numeric">Principal</th><th
              class="numeric">Prepaid</th
            ><th class="numeric">Ending balance</th></tr
          ></thead
        >
        <tbody>
          {#each projection.years as year (year.year)}
            <tr>
              <td>{year.year}</td>
              <td class="numeric">{money(year.interest)}</td>
              <td class="numeric">{money(year.principal)}</td>
              <td class="numeric">{money(year.prepaid)}</td>
              <td class="numeric">{money(year.endingBalance)}</td>
            </tr>
          {/each}
        </tbody>
      </Table>
    </details>
  {/if}
</section>
