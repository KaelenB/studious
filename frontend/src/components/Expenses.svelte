<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Alert,
    Badge,
    Button,
    Card,
    Col,
    Form,
    Input,
    Label,
    Row,
    Spinner,
    Table,
  } from '@sveltestrap/sveltestrap';
  import type {
    Expense,
    ExpenseCategory,
    ExpenseInput,
    ExpensePage,
    Household,
    Member,
  } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { cents, formatMoney, localDateTime } from '../lib/money';

  let {
    household,
    members,
    disabled = false,
    onbusy,
  }: {
    household: Household;
    members: Member[];
    disabled?: boolean;
    onbusy: (busy: boolean) => void;
  } = $props();
  const initialMonth = localDateTime().slice(0, 7);
  let month = $state(initialMonth);
  let monthInput = $state(initialMonth);
  let categories = $state<ExpenseCategory[]>([]);
  let page = $state<ExpensePage | null>(null);
  let offset = $state(0);
  let loading = $state(true);
  let busy = $state(false);
  let loadError = $state('');
  let error = $state('');
  let success = $state('');
  let editing = $state<Expense | null>(null);
  let showForm = $state(false);
  let archiveId = $state<string | null>(null);
  let name = $state('');
  let amount = $state('');
  let currency = $state('');
  let date = $state('');
  let categoryId = $state('');
  let memberId = $state('');
  let categoryName = $state('');
  let controller: AbortController | undefined;
  const locked = $derived(disabled || busy || loading);
  const items = $derived(page?.items.slice(0, 20) ?? []);
  const hasNext = $derived((page?.items.length ?? 0) > 20);

  async function load(nextOffset = offset) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading = true;
    loadError = '';
    try {
      const [nextPage, nextCategories] = await Promise.all([
        api.expenses(household.id, month, 21, nextOffset, current.signal),
        api.expenseCategories(household.id, current.signal),
      ]);
      if (current.signal.aborted) return;
      page = nextPage;
      categories = nextCategories;
      offset = nextOffset;
    } catch (cause) {
      if (!current.signal.aborted) loadError = errorMessage(cause);
    } finally {
      if (!current.signal.aborted) loading = false;
    }
  }

  onMount(() => {
    void load(0);
    return () => controller?.abort();
  });

  function setBusy(value: boolean) {
    busy = value;
    onbusy(value);
  }

  function edit(expense: Expense | null) {
    editing = expense;
    name = expense?.name ?? '';
    amount = expense?.amount ?? '';
    currency = expense?.currency ?? household.defaultCurrency;
    date = expense?.startDate ?? localDateTime().slice(0, 10);
    categoryId = expense?.categoryId ?? '';
    memberId = expense?.memberId ?? '';
    error = '';
    success = '';
    archiveId = null;
    showForm = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    error = '';
    success = '';
    try {
      const input: ExpenseInput = {
        name,
        amount,
        currency,
        startDate: date,
        categoryId: categoryId || null,
        memberId: memberId || null,
      };
      const saved = editing
        ? await api.updateExpense(household.id, editing.id, input)
        : await api.addExpense(household.id, input);
      showForm = false;
      editing = null;
      month = saved.startDate.slice(0, 7);
      monthInput = month;
      page = null;
      offset = 0;
      success = 'Expense saved.';
      await load(0);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    error = '';
    success = '';
    try {
      await api.addExpenseCategory(household.id, categoryName.trim());
      categoryName = '';
      success = 'Category added.';
      await load();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }

  async function archive(expenseId: string) {
    setBusy(true);
    error = '';
    success = '';
    try {
      await api.archiveExpense(household.id, expenseId);
      archiveId = null;
      success = 'Expense archived. It is excluded from monthly totals.';
      await load(0);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }

  function changeMonth(event: SubmitEvent) {
    event.preventDefault();
    month = monthInput;
    page = null;
    offset = 0;
    archiveId = null;
    success = '';
    void load(0);
  }
</script>

<Card id="expenses" class="expenses-section" role="region" aria-label="Household expenses">
  <div class="section-heading">
    <div>
      <h2>Expenses</h2>
      <p class="muted small">
        One-off spending, organized by calendar month. Entries do not change account balances.
      </p>
    </div>
    <Button color="primary" disabled={locked} on:click={() => edit(null)}>+ Add expense</Button>
  </div>
  <Form class="d-flex flex-wrap gap-2 align-items-end mb-3" on:submit={changeMonth}>
    <div>
      <Label for="expense-month">Expense month</Label><Input
        id="expense-month"
        type="month"
        required
        min="1000-01"
        max="9999-12"
        bind:value={monthInput}
        disabled={locked}
      />
    </div>
    <Button type="submit" color="primary" outline disabled={locked}>Show month</Button>
  </Form>
  {#if loadError}<Alert color="danger" fade={false}
      >Could not load expenses. Displayed values may be out of date. {loadError}
      <Button color="link" disabled={locked} on:click={() => void load()}>Retry expenses</Button
      ></Alert
    >{/if}
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  {#if success}<Alert color="success" fade={false}>{success}</Alert>{/if}
  {#if loading}<p role="status"><Spinner size="sm" class="me-2" />Loading expenses...</p>{/if}
  {#if page}
    <div aria-label="Monthly expense totals" class="d-flex flex-wrap gap-2 mb-3">
      {#each page.totals as total}<Badge color="light" class="text-success border"
          >{month} · {formatMoney(cents(total.amount), total.currency)}</Badge
        >{:else}<p class="muted">No expenses for {month}.</p>{/each}
    </div>
  {/if}
  {#if showForm}
    <Form on:submit={save} class="border rounded p-3 mb-3" aria-label="Expense form">
      <h3>{editing ? 'Edit expense' : 'New expense'}</h3>
      <Row>
        <Col md={6}
          ><Label for="expense-name">Expense name</Label><Input
            id="expense-name"
            required
            maxlength={200}
            bind:value={name}
            disabled={locked}
          /></Col
        >
        <Col md={3}
          ><Label for="expense-amount">Expense amount</Label><Input
            id="expense-amount"
            type="text"
            inputmode="decimal"
            pattern={'(?:0|[1-9][0-9]{0,11})\\.[0-9]{2}'}
            placeholder="0.00"
            required
            bind:value={amount}
            disabled={locked}
          /></Col
        >
        <Col md={3}
          ><Label for="expense-currency">Expense currency</Label><Input
            id="expense-currency"
            required
            maxlength={3}
            pattern={'[A-Z]{3}'}
            bind:value={currency}
            disabled={locked}
          /></Col
        >
      </Row>
      <Row class="mt-2 mb-3">
        <Col md={4}
          ><Label for="expense-date">Expense date</Label><Input
            id="expense-date"
            type="date"
            required
            min="1000-01-01"
            max="9999-12-31"
            bind:value={date}
            disabled={locked}
          /></Col
        >
        <Col md={4}
          ><Label for="expense-category">Expense category</Label><Input
            id="expense-category"
            type="select"
            bind:value={categoryId}
            disabled={locked}
            ><option value="">Uncategorized</option>{#each categories as category}<option
                value={category.id}>{category.name}</option
              >{/each}</Input
          ></Col
        >
        <Col md={4}
          ><Label for="expense-member">Expense member</Label><Input
            id="expense-member"
            type="select"
            bind:value={memberId}
            disabled={locked}
            ><option value="">Shared household</option>{#each members as member}<option
                value={member.id}>{member.name}</option
              >{/each}</Input
          ></Col
        >
      </Row>
      <div class="d-flex flex-wrap gap-2">
        <Button type="submit" color="primary" disabled={locked}
          >{busy ? 'Saving...' : 'Save expense'}</Button
        ><Button
          color="secondary"
          outline
          disabled={locked}
          on:click={() => {
            showForm = false;
            error = '';
          }}>Cancel expense</Button
        >
      </div>
    </Form>
  {/if}
  {#if items.length}
    <Table responsive hover class="expense-table" aria-label="Expense history">
      <thead
        ><tr
          ><th>Date</th><th>Expense</th><th>Category / member</th><th class="numeric">Amount</th><th
            class="expense-actions">Actions</th
          ></tr
        ></thead
      >
      <tbody
        >{#each items as expense (expense.id)}<tr>
            <td class="expense-date text-nowrap">{expense.startDate}</td>
            <td class="expense-name">{expense.name}</td>
            <td class="expense-meta"
              >{categories.find((category) => category.id === expense.categoryId)?.name ??
                'Uncategorized'}<br /><span class="muted small"
                >{members.find((member) => member.id === expense.memberId)?.name ??
                  'Shared household'}</span
              ></td
            >
            <td class="expense-amount numeric text-nowrap"
              >{formatMoney(cents(expense.amount), expense.currency)}</td
            >
            <td class="expense-actions"
              ><div class="d-flex flex-wrap gap-2 align-items-center">
                {#if archiveId === expense.id}
                  <span>Archive {expense.name}?</span><Button
                    color="danger"
                    size="sm"
                    disabled={locked}
                    on:click={() => void archive(expense.id)}>Confirm expense archive</Button
                  ><Button
                    color="secondary"
                    outline
                    size="sm"
                    disabled={locked}
                    on:click={() => (archiveId = null)}>Keep expense</Button
                  >
                {:else}
                  <Button
                    color="primary"
                    outline
                    size="sm"
                    disabled={locked}
                    aria-label={`Edit expense ${expense.name}`}
                    on:click={() => edit(expense)}>Edit</Button
                  ><Button
                    color="danger"
                    outline
                    size="sm"
                    disabled={locked || showForm}
                    aria-label={`Archive expense ${expense.name}`}
                    on:click={() => (archiveId = expense.id)}>Archive</Button
                  >
                {/if}
              </div></td
            >
          </tr>{/each}</tbody
      >
    </Table>
  {/if}
  {#if page && (offset > 0 || hasNext)}
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3" aria-label="Expense pages">
      <Button
        color="primary"
        outline
        disabled={locked || offset === 0}
        on:click={() => void load(offset - 20)}>Previous expenses</Button
      >
      <span class="small">Page {offset / 20 + 1}</span>
      <Button
        color="primary"
        outline
        disabled={locked || !hasNext}
        on:click={() => void load(offset + 20)}>Next expenses</Button
      >
    </div>
  {/if}
  <div class="border-top pt-3">
    <h3>Expense categories</h3>
    <div class="d-flex flex-wrap gap-2 mb-3">
      {#each categories as category}<Badge color="light" class="text-success border"
          >{category.name}</Badge
        >{:else}<p class="muted small">Add categories such as Groceries or Utilities.</p>{/each}
    </div>
    <Form class="d-flex flex-wrap gap-2 align-items-end" on:submit={addCategory}>
      <div>
        <Label for="expense-category-name">New expense category</Label><Input
          id="expense-category-name"
          required
          maxlength={200}
          bind:value={categoryName}
          disabled={locked}
        />
      </div>
      <Button type="submit" color="primary" outline disabled={locked}>Add category</Button>
    </Form>
  </div>
</Card>
