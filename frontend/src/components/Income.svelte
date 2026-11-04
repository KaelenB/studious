<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Alert,
    Badge,
    Button,
    Card,
    Form,
    Input,
    Label,
    Spinner,
  } from '@sveltestrap/sveltestrap';
  import type { Household, Income, IncomePage, Member } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { cents, formatMoney, localDateTime } from '../lib/money';

  let {
    household,
    members,
    revision,
    disabled = false,
    onbusy,
  }: {
    household: Household;
    members: Member[];
    revision: number;
    disabled?: boolean;
    onbusy: (busy: boolean) => void;
  } = $props();
  const initialMonth = localDateTime().slice(0, 7);
  let month = $state(initialMonth);
  let monthInput = $state(initialMonth);
  let page = $state<IncomePage | null>(null);
  let offset = $state(0);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let loadError = $state('');
  let success = $state('');
  let showForm = $state(false);
  let editing = $state<Income | null>(null);
  let archiveId = $state<string | null>(null);
  let name = $state('');
  let amount = $state('');
  let currency = $state('');
  let date = $state('');
  let memberId = $state('');
  let controller: AbortController | undefined;
  const locked = $derived(disabled || busy || loading);
  const items = $derived(page?.items.slice(0, 20) ?? []);

  async function load(nextOffset = offset) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading = true;
    loadError = '';
    try {
      const next = await api.income(household.id, month, 21, nextOffset, current.signal);
      if (current.signal.aborted) return;
      page = next;
      offset = nextOffset;
    } catch (cause) {
      if (!current.signal.aborted) loadError = errorMessage(cause);
    } finally {
      if (!current.signal.aborted) loading = false;
    }
  }
  $effect(() => {
    void revision;
    untrack(() => void load(0));
    return () => controller?.abort();
  });
  function setBusy(value: boolean) {
    busy = value;
    onbusy(value);
  }
  function edit(row: Income | null) {
    editing = row;
    name = row?.name ?? '';
    amount = row?.amount ?? '';
    currency = row?.currency ?? household.defaultCurrency;
    date = row?.startDate ?? localDateTime().slice(0, 10);
    memberId = row?.memberId ?? '';
    showForm = true;
    archiveId = null;
    error = '';
    success = '';
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    error = '';
    success = '';
    try {
      const input = { name, amount, currency, startDate: date, memberId: memberId || null };
      const saved = editing
        ? await api.updateIncome(household.id, editing.id, input)
        : await api.addIncome(household.id, input);
      month = saved.startDate.slice(0, 7);
      monthInput = month;
      showForm = false;
      editing = null;
      page = null;
      success = 'Income saved.';
      await load(0);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    setBusy(true);
    error = '';
    success = '';
    try {
      await api.archiveIncome(household.id, id);
      archiveId = null;
      success = 'Income archived. It is excluded from monthly totals.';
      await load(0);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }
</script>

<Card id="income" role="region" aria-label="Household income">
  <div class="section-heading">
    <div>
      <h2>Income</h2>
      <p class="muted small">
        Recorded receipts by calendar month, including historical income. These entries do not
        change account balances or imply gross salary.
      </p>
    </div>
    <Button color="primary" disabled={locked} on:click={() => edit(null)}>+ Add income</Button>
  </div>
  <Form
    class="d-flex flex-wrap gap-2 align-items-end mb-3"
    on:submit={(event: SubmitEvent) => {
      event.preventDefault();
      month = monthInput;
      page = null;
      success = '';
      archiveId = null;
      void load(0);
    }}
  >
    <div>
      <Label for="income-month">Income month</Label><Input
        id="income-month"
        type="month"
        min="1000-01"
        max="9999-12"
        required
        bind:value={monthInput}
        disabled={locked}
      />
    </div>
    <Button type="submit" color="primary" outline disabled={locked}>Show month</Button>
  </Form>
  {#if loadError}<Alert color="danger" fade={false}
      >Could not load income. Displayed values may be out of date. {loadError}<Button
        color="link"
        disabled={locked}
        on:click={() => void load()}>Retry income</Button
      ></Alert
    >{/if}
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  {#if success}<Alert color="success" fade={false}>{success}</Alert>{/if}
  {#if loading}<p role="status"><Spinner size="sm" class="me-2" />Loading income...</p>{/if}
  {#if page}<div aria-label="Monthly income totals" class="d-flex flex-wrap gap-2 mb-3">
      {#each page.totals as total}<Badge color="light" class="text-success border"
          >{month} · {formatMoney(cents(total.amount), total.currency)}</Badge
        >
      {:else}<p class="muted">No income for {month}.</p>{/each}
    </div>{/if}
  {#if showForm}
    <Form on:submit={save} class="border rounded p-3 mb-3" aria-label="Income form">
      <h3>{editing ? 'Edit income' : 'New income'}</h3>
      <div class="ledger-fields">
        <div>
          <Label for="income-name">Income name</Label><Input
            id="income-name"
            maxlength={200}
            required
            bind:value={name}
            disabled={locked}
          />
        </div>
        <div>
          <Label for="income-amount">Income amount</Label><Input
            id="income-amount"
            inputmode="decimal"
            pattern={'(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'}
            placeholder="0.00"
            required
            bind:value={amount}
            disabled={locked}
          />
        </div>
        <div>
          <Label for="income-currency">Income currency</Label><Input
            id="income-currency"
            minlength={3}
            maxlength={3}
            pattern={'[A-Z]{3}'}
            required
            bind:value={currency}
            disabled={locked}
          />
        </div>
        <div>
          <Label for="income-date">Income date</Label><Input
            id="income-date"
            type="date"
            min="1000-01-01"
            max="9999-12-31"
            required
            bind:value={date}
            disabled={locked}
          />
        </div>
        <div>
          <Label for="income-member">Income member</Label><Input
            id="income-member"
            type="select"
            bind:value={memberId}
            disabled={locked}
            ><option value="">Shared household</option>{#each members as member}<option
                value={member.id}>{member.name}</option
              >{/each}</Input
          >
        </div>
      </div>
      <div class="d-flex gap-2 mt-3">
        <Button color="primary" type="submit" disabled={locked}>Save income</Button><Button
          color="secondary"
          outline
          disabled={locked}
          on:click={() => (showForm = false)}>Cancel</Button
        >
      </div>
    </Form>
  {/if}
  {#if items.length}
    <div class="table-responsive">
      <table class="table expense-table">
        <thead
          ><tr
            ><th scope="col">Income</th><th scope="col">Member</th><th scope="col">Date</th><th
              scope="col"
              class="numeric">Amount</th
            ><th scope="col">Actions</th></tr
          ></thead
        >
        <tbody>
          {#each items as item (item.id)}
            <tr>
              <td class="expense-name"><strong>{item.name}</strong></td>
              <td class="expense-meta muted small"
                >{members.find((member) => member.id === item.memberId)?.name ??
                  'Shared household'}</td
              >
              <td class="expense-date">{item.startDate}</td>
              <td class="expense-amount numeric"
                >{formatMoney(cents(item.amount), item.currency)}</td
              >
              <td class="expense-actions">
                {#if archiveId === item.id}
                  <span class="small">Archive this income?</span><Button
                    color="danger"
                    size="sm"
                    disabled={locked}
                    on:click={() => archive(item.id)}>Confirm archive</Button
                  ><Button
                    color="link"
                    size="sm"
                    disabled={locked}
                    on:click={() => (archiveId = null)}>Cancel</Button
                  >
                {:else}
                  <Button
                    color="link"
                    size="sm"
                    disabled={locked}
                    aria-label={`Edit income ${item.name}`}
                    on:click={() => edit(item)}>Edit</Button
                  >
                  <Button
                    color="link"
                    size="sm"
                    disabled={locked}
                    aria-label={`Archive income ${item.name}`}
                    on:click={() => (archiveId = item.id)}>Archive</Button
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="d-flex align-items-center gap-2">
    <Button
      color="primary"
      outline
      size="sm"
      disabled={locked || offset === 0}
      on:click={() => void load(Math.max(0, offset - 20))}>Previous</Button
    >
    <span class="muted small">Page {Math.floor(offset / 20) + 1}</span>
    <Button
      color="primary"
      outline
      size="sm"
      disabled={locked || (page?.items.length ?? 0) <= 20}
      on:click={() => void load(offset + 20)}>Next</Button
    >
  </div>
</Card>
