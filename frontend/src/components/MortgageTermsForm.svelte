<script lang="ts">
  import { untrack } from 'svelte';
  import { Alert, Button, Col, Form, Input, Label, Row } from '@sveltestrap/sveltestrap';
  import {
    compoundingFrequencies,
    compoundingLabels,
    durationLabel,
    errorMessage,
    moneyPattern,
    paymentFrequencies,
    paymentFrequencyLabels,
    ratePattern,
    rateTypeLabels,
    rateTypes,
    type MortgageTerms,
    type MortgageTermsInput,
  } from '../lib/api';

  let {
    terms = null,
    currency,
    onsave,
    oncancel,
  }: {
    terms?: MortgageTerms | null;
    currency: string;
    onsave: (input: MortgageTermsInput) => Promise<void>;
    oncancel?: () => void;
  } = $props();
  const initial = untrack(() => terms);
  let principal = $state(initial?.principal ?? '');
  let annualRate = $state(initial?.annualRate ?? '');
  let rateType = $state(initial?.rateType ?? 'FIXED');
  let compounding = $state(initial?.compounding ?? 'SEMI_ANNUAL');
  let amortizationYears = $state(String(Math.floor((initial?.amortizationMonths ?? 300) / 12)));
  let amortizationExtra = $state(String((initial?.amortizationMonths ?? 300) % 12));
  let termMonths = $state(String(initial?.termMonths ?? 60));
  let paymentFrequency = $state(initial?.paymentFrequency ?? 'MONTHLY');
  let startDate = $state(initial?.startDate ?? '');
  let paymentAmount = $state(initial?.paymentAmount ?? '');
  let propertyValue = $state(initial?.propertyValue ?? '');
  let busy = $state(false);
  let error = $state('');
  const termOptions = [6, 12, 24, 36, 48, 60, 72, 84, 120];

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    const amortizationMonths = Number(amortizationYears) * 12 + Number(amortizationExtra);
    const optional = [paymentAmount, propertyValue].filter(Boolean);
    if (![principal, ...optional].every((value) => moneyPattern.test(value))) {
      error = 'Enter amounts with exactly two decimal places (e.g. 450000.00).';
    } else if (!ratePattern.test(annualRate) || Number(annualRate) > 30) {
      error = 'Enter the annual rate as a percentage such as 4.79.';
    } else if (
      !Number.isInteger(amortizationMonths) ||
      amortizationMonths < 1 ||
      amortizationMonths > 600
    ) {
      error = 'Amortization must be between 1 month and 50 years.';
    } else if (!startDate) {
      error = 'Enter the date the mortgage (or current term) started.';
    }
    if (error) return;
    busy = true;
    try {
      await onsave({
        principal,
        annualRate,
        rateType,
        compounding,
        amortizationMonths,
        termMonths: Number(termMonths),
        paymentFrequency,
        startDate,
        paymentAmount: paymentAmount || null,
        propertyValue: propertyValue || null,
      });
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<Form on:submit={save} aria-label="Mortgage terms">
  <div class="section-heading">
    <h3>{terms ? 'Edit mortgage terms' : 'Set up mortgage terms'}</h3>
    {#if oncancel}<Button type="button" color="link" disabled={busy} on:click={oncancel}
        >Cancel</Button
      >{/if}
  </div>
  <p class="muted small">
    Enter the principal at the start of the current term. For a renewal, use the balance and date
    you renewed at, with the remaining amortization.
  </p>
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  <Row class="g-3 mb-3">
    <Col md="4">
      <Label for="mortgage-principal">Principal ({currency})</Label><Input
        id="mortgage-principal"
        inputmode="decimal"
        required
        bind:value={principal}
        placeholder="450000.00"
      />
    </Col>
    <Col md="4">
      <Label for="mortgage-rate">Annual rate (%)</Label><Input
        id="mortgage-rate"
        inputmode="decimal"
        required
        bind:value={annualRate}
        placeholder="4.79"
      />
    </Col>
    <Col md="4">
      <Label for="mortgage-start">Start date</Label><Input
        id="mortgage-start"
        type="date"
        required
        bind:value={startDate}
      />
    </Col>
    <Col md="4">
      <Label for="mortgage-rate-type">Rate type</Label><Input
        type="select"
        id="mortgage-rate-type"
        bind:value={rateType}
        >{#each rateTypes as value}<option {value}>{rateTypeLabels[value]}</option>{/each}</Input
      >
    </Col>
    <Col md="4">
      <Label for="mortgage-compounding">Compounding</Label><Input
        type="select"
        id="mortgage-compounding"
        bind:value={compounding}
        >{#each compoundingFrequencies as value}<option {value}>{compoundingLabels[value]}</option
          >{/each}</Input
      >
    </Col>
    <Col md="4">
      <Label for="mortgage-frequency">Payment frequency</Label><Input
        type="select"
        id="mortgage-frequency"
        bind:value={paymentFrequency}
        >{#each paymentFrequencies as value}<option {value}>{paymentFrequencyLabels[value]}</option
          >{/each}</Input
      >
    </Col>
    <Col md="4">
      <Label for="mortgage-amortization-years">Amortization (years)</Label><Input
        id="mortgage-amortization-years"
        type="number"
        min="0"
        max="50"
        required
        bind:value={amortizationYears}
      />
    </Col>
    <Col md="4">
      <Label for="mortgage-amortization-months">Plus months</Label><Input
        id="mortgage-amortization-months"
        type="number"
        min="0"
        max="11"
        required
        bind:value={amortizationExtra}
      />
    </Col>
    <Col md="4">
      <Label for="mortgage-term">Term</Label><Input
        type="select"
        id="mortgage-term"
        bind:value={termMonths}
        >{#each termOptions.includes(Number(termMonths)) ? termOptions : [Number(termMonths), ...termOptions] as months}<option
            value={String(months)}>{durationLabel(months)}</option
          >{/each}</Input
      >
    </Col>
    <Col md="6">
      <Label for="mortgage-payment">Lender's regular payment (optional)</Label><Input
        id="mortgage-payment"
        inputmode="decimal"
        bind:value={paymentAmount}
        placeholder="Calculated from the terms"
      />
    </Col>
    <Col md="6">
      <Label for="mortgage-property">Property value (optional)</Label><Input
        id="mortgage-property"
        inputmode="decimal"
        bind:value={propertyValue}
        placeholder="Used to show home equity"
      />
    </Col>
  </Row>
  <Button type="submit" color="primary" disabled={busy}
    >{busy ? 'Saving...' : 'Save mortgage terms'}</Button
  >
</Form>
