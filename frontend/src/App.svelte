<script lang="ts">
  import { onMount } from 'svelte';
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
  import Setup from './components/Setup.svelte';
  import AccountForm from './components/AccountForm.svelte';
  import AccountDetail from './components/AccountDetail.svelte';
  import Expenses from './components/Expenses.svelte';
  import StorageMeter from './components/StorageMeter.svelte';
  import Overview from './components/Overview.svelte';
  import Income from './components/Income.svelte';
  import BudgetImport from './components/BudgetImport.svelte';
  import {
    api,
    accountKind,
    errorMessage,
    type Household,
    type Member,
    type AccountSummary,
    type AccountInput,
  } from './lib/api';
  import { cents, formatMoney, totals } from './lib/money';

  let household = $state<Household | null>(null);
  let members = $state<Member[]>([]);
  let summaries = $state<AccountSummary[]>([]);
  let selectedId = $state<string | null>(null);
  let form = $state<'create' | 'edit' | null>(null);
  let loading = $state(true);
  let error = $state('');
  let storageWarning = $state('');
  let backupBusy = $state(false);
  let backupError = $state('');
  async function downloadDatabase() {
    backupBusy = true;
    backupError = '';
    try {
      const blob = await api.downloadDatabase();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `studious-${new Date().toISOString().slice(0, 10)}.sqlite`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      backupError = errorMessage(cause);
    } finally {
      backupBusy = false;
    }
  }
  let memberName = $state('');
  let memberBusy = $state(false);
  let mutationBusy = $state(false);
  let expenseBusy = $state(false);
  let incomeBusy = $state(false);
  let importBusy = $state(false);
  let memberError = $state('');
  let revision = $state(0);
  let expenseRevision = $state(0);
  let savedId = $state('');
  let loadController: AbortController | undefined;
  const selected = $derived(
    summaries.find((item) => item.account.id === selectedId)?.account ?? null,
  );
  const groups = $derived(totals(summaries));

  function remember(id: string | null) {
    savedId = id ?? '';
    try {
      if (id) localStorage.setItem('studious.householdId', id);
      else localStorage.removeItem('studious.householdId');
    } catch {
      storageWarning = 'Browser storage is unavailable. Save your household ID before leaving.';
    }
  }

  async function open(next: Household) {
    // Remember creation before subsequent reads, so a failed refresh cannot lose its ID.
    remember(next.id);
    await load(next.id);
  }

  async function load(id: string) {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    loading = true;
    error = '';
    try {
      const [nextHousehold, nextMembers, accounts] = await Promise.all([
        api.household(id, controller.signal),
        api.members(id, controller.signal),
        api.accounts(id, controller.signal),
      ]);
      const nextSummaries = await Promise.all(
        accounts.map(async (account) => ({
          account,
          latest: (await api.balances(id, account.id, 1, 0, controller.signal))[0] ?? null,
        })),
      );
      if (controller.signal.aborted) return;
      household = nextHousehold;
      members = nextMembers;
      summaries = nextSummaries;
      if (!accounts.some((account) => account.id === selectedId)) selectedId = null;
      revision++;
    } catch (cause) {
      if (!controller.signal.aborted) {
        error = errorMessage(cause);
        throw cause;
      }
    } finally {
      if (!controller.signal.aborted) loading = false;
    }
  }

  async function refresh() {
    if (!household) return;
    try {
      await load(household.id);
    } catch {
      /* The load error is displayed with a retry action. */
    }
  }

  function disconnect() {
    loadController?.abort();
    remember(null);
    household = null;
    members = [];
    summaries = [];
    selectedId = null;
    form = null;
    error = '';
    loading = false;
  }

  onMount(() => {
    try {
      savedId = localStorage.getItem('studious.householdId') ?? '';
    } catch {
      storageWarning =
        'Browser storage is unavailable. You can still connect using your household ID.';
    }
    if (savedId)
      void load(savedId).catch(() => {
        /* Displayed in the startup error state. */
      });
    else loading = false;
    return () => loadController?.abort();
  });

  async function saveAccount(input: AccountInput) {
    if (!household) throw new Error('Connect a household first.');
    mutationBusy = true;
    try {
      const account =
        form === 'edit' && selected
          ? await api.updateAccount(household.id, selected.id, {
              name: input.name,
              memberId: input.memberId,
              ...(selected.type === 'INVESTMENT' ? { subtype: input.subtype ?? null } : {}),
            })
          : await api.addAccount(household.id, input);
      form = null;
      selectedId = account.id;
      await refresh();
    } finally {
      mutationBusy = false;
    }
  }

  async function recordBalance(amount: string, asOf: string) {
    if (!household || !selected) throw new Error('Select an account first.');
    mutationBusy = true;
    try {
      await api.addBalance(household.id, selected.id, amount, asOf);
      await refresh();
    } finally {
      mutationBusy = false;
    }
  }

  async function importStatement(file: File, statementDate?: string) {
    if (!household || !selected) throw new Error('Select an account first.');
    mutationBusy = true;
    try {
      await api.importStatement(household.id, selected.id, file.name, file, statementDate);
      await refresh();
    } finally {
      mutationBusy = false;
    }
  }

  async function addMember(event: SubmitEvent) {
    event.preventDefault();
    if (!household) return;
    memberBusy = true;
    memberError = '';
    try {
      await api.addMember(household.id, memberName.trim());
      memberName = '';
      await refresh();
    } catch (cause) {
      memberError = errorMessage(cause);
    } finally {
      memberBusy = false;
    }
  }

  async function archive() {
    if (!household || !selected) throw new Error('Select an account first.');
    mutationBusy = true;
    try {
      await api.archiveAccount(household.id, selected.id);
      selectedId = null;
      form = null;
      await refresh();
    } finally {
      mutationBusy = false;
    }
  }
</script>

<svelte:head
  ><title>Studious | Household finances</title><meta
    name="description"
    content="A clear, shared view of your household accounts, balances and expenses."
  /></svelte:head
>

<a class="skip-link" href="#main">Skip to content</a>
<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href={import.meta.env.BASE_URL} aria-label="Studious home"
      ><span class="brand-mark" aria-hidden="true">s.</span>studious<span class="brand-dot">.</span
      ></a
    >
    <div class="sidebar-label">YOUR FINANCES</div>
    <nav aria-label="Main navigation">
      <a href="#main" aria-current="page"><span aria-hidden="true">◫</span> Overview</a
      >{#if household}<a href="#accounts"><span aria-hidden="true">▤</span> Accounts</a><a
          href="#expenses"><span aria-hidden="true">▤</span> Expenses</a
        ><a href="#income"><span aria-hidden="true">+</span> Income</a><a href="#historical"
          ><span aria-hidden="true">+</span> Import history</a
        ><a href="#household"><span aria-hidden="true">◎</span> Household</a>{/if}
    </nav>
    <div class="sidebar-bottom">
      <span class="status-dot"></span> Shared workspace
      <p>Your data. Your household.</p>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <span>Household finance dashboard</span><span class="env-tag">PREVIEW</span>
    </header>
    <main id="main">
      {#if storageWarning}<Alert color="warning" fade={false}>{storageWarning}</Alert>{/if}
      {#if loading && !household}<Card role="status">
          <div><Spinner size="sm" class="me-2" />Connecting to your household...</div>
        </Card>
      {:else if !household}
        {#if error}<Card>
            <Alert color="danger" fade={false}>{error}</Alert>
            <p>Your saved household ID: <code>{savedId}</code></p>
            <div class="d-flex flex-wrap gap-2">
              <Button color="primary" on:click={() => void load(savedId).catch(() => {})}
                >Retry connection</Button
              >
              <Button color="primary" outline on:click={disconnect}>Use another household</Button>
            </div>
          </Card>
        {:else}<Setup onopen={open} />{/if}
      {:else}
        <div class="page-heading">
          <div>
            <div class="eyebrow">{household.name}</div>
            <h1>Your financial overview<span class="accent">.</span></h1>
            <p class="muted">A little clarity for the bigger picture.</p>
          </div>
          <Button
            color="primary"
            disabled={loading || mutationBusy || importBusy}
            on:click={() => {
              form = 'create';
            }}>+ Add account</Button
          >
        </div>
        {#if error}<Alert color="danger" fade={false}>
            Could not refresh data. Displayed values may be out of date. {error}
            <Button color="link" on:click={refresh}>Retry</Button>
          </Alert>{/if}
        {#if loading}<p role="status" class="muted">
            <Spinner size="sm" class="me-2" />Refreshing your accounts...
          </p>{/if}
        <section aria-label="Financial summary" class="summary-area">
          {#each groups as group}
            <div class="summary-grid">
              <Card class="summary-card net-card">
                <div class="eyebrow">Recorded net worth · {group.currency}</div>
                <div class="summary-value">{formatMoney(group.net, group.currency)}</div>
                <p>Recorded assets minus recorded debts</p>
              </Card>
              <Card class="summary-card">
                <div class="eyebrow">Recorded assets · {group.currency}</div>
                <div class="summary-value">{formatMoney(group.assets, group.currency)}</div>
                <p>Deposit and investment accounts</p>
              </Card>
              <Card class="summary-card">
                <div class="eyebrow">Recorded debts · {group.currency}</div>
                <div class="summary-value">{formatMoney(group.debts, group.currency)}</div>
                <p>Credit, loan, and mortgage accounts</p>
              </Card>
            </div>
            {#if group.missing}<Alert color="warning" fade={false}>
                {group.missing}
                {group.currency} account(s) have no balance and are excluded from totals.
              </Alert>{/if}
          {:else}<Card class="empty-summary">
              <div class="eyebrow">Your starting point</div>
              <h2>A clearer picture starts with one account.</h2>
              <p class="muted">
                Add an account, then record its balance. No sample numbers, just your data.
              </p>
            </Card>{/each}
          {#if groups.length}<p class="muted small">
              Latest recorded observations, not live bank balances. Currencies are shown separately;
              no exchange rates are applied.
            </p>{/if}
        </section>
        {#key household.id}
          <Overview
            householdId={household.id}
            defaultCurrency={household.defaultCurrency}
            accounts={summaries.map((item) => item.account)}
            {members}
            revision={revision + expenseRevision}
          />
        {/key}
        {#if form}{#key `${form}:${selectedId ?? ''}`}<AccountForm
              {members}
              currency={household.defaultCurrency}
              account={form === 'edit' ? selected : null}
              onsave={saveAccount}
              oncancel={() => (form = null)}
            />{/key}{/if}
        <Card id="accounts" class="accounts-section" role="region" aria-label="Your accounts">
          <div class="section-heading">
            <div>
              <h2>Your accounts</h2>
              <p class="muted small">Everything in one place, one balance at a time.</p>
            </div>
            <Badge color="light" class="text-success border">{summaries.length} active</Badge>
          </div>
          {#if summaries.length === 0}<div class="empty-state">
              <span class="empty-symbol" aria-hidden="true">+</span>
              <h3>No accounts yet</h3>
              <p class="muted">Start with your everyday chequing or savings account.</p>
              <Button color="primary" outline on:click={() => (form = 'create')}
                >Add your first account</Button
              >
            </div>
          {:else}<div class="account-list">
              {#each summaries as { account, latest } (account.id)}
                <Button
                  color="link"
                  disabled={mutationBusy}
                  class={`account-row ${selectedId === account.id ? 'chosen' : ''}`}
                  on:click={() => {
                    selectedId = account.id;
                    form = null;
                  }}
                  aria-pressed={selectedId === account.id}
                >
                  <span class="account-icon" aria-hidden="true"
                    >{account.name.slice(0, 1).toUpperCase()}</span
                  >
                  <span class="account-info"
                    ><strong>{account.name}</strong><span
                      >{accountKind(account)} · {members.find(
                        (member) => member.id === account.memberId,
                      )?.name ?? 'Shared household'}</span
                    ></span
                  >
                  <span class="account-balance"
                    ><strong
                      >{latest
                        ? formatMoney(cents(latest.amount), account.currency)
                        : 'No balance yet'}</strong
                    ><span
                      >{latest
                        ? `Manual · ${new Date(latest.asOf).toLocaleDateString('en-CA')}`
                        : 'Record a starting balance'}</span
                    ></span
                  >
                  <span class="row-arrow" aria-hidden="true">→</span>
                </Button>
              {/each}
            </div>{/if}
        </Card>
        {#if selected && !form}{#key selected.id}<AccountDetail
              account={selected}
              {revision}
              onrecord={recordBalance}
              onimport={importStatement}
              onedit={() => (form = 'edit')}
              onarchive={archive}
            />{/key}{/if}
        {#key household.id}
          <Expenses
            {household}
            {members}
            {revision}
            disabled={loading || mutationBusy || memberBusy || importBusy}
            onbusy={(busy) => {
              if (expenseBusy && !busy) expenseRevision++;
              expenseBusy = busy;
            }}
          />
          <Income
            {household}
            {members}
            {revision}
            disabled={loading || mutationBusy || memberBusy || importBusy}
            onbusy={(busy) => {
              if (incomeBusy && !busy) expenseRevision++;
              incomeBusy = busy;
            }}
          />
          <BudgetImport
            {household}
            {members}
            disabled={loading || mutationBusy || memberBusy || expenseBusy || incomeBusy}
            onbusy={(busy) => (importBusy = busy)}
            onimport={refresh}
          />
        {/key}
        <Card id="household" class="household-section">
          <div class="section-heading">
            <div>
              <div class="eyebrow">Your workspace</div>
              <h2>Household</h2>
            </div>
            <Button
              color="link"
              disabled={loading ||
                memberBusy ||
                mutationBusy ||
                expenseBusy ||
                incomeBusy ||
                importBusy}
              on:click={disconnect}>Switch household</Button
            >
          </div>
          <p class="muted small">
            Save this ID to reconnect from another browser. This browser remembers only the ID, not
            your financial data.
          </p>
          <code class="household-id">{household.id}</code>
          <div class="member-chips">
            {#each members as member}<Badge color="light" pill class="member-chip"
                >{member.name}</Badge
              >{:else}<span class="muted small">No members added. Accounts can stay shared.</span
              >{/each}
          </div>
          <Form class="member-form" on:submit={addMember}>
            <div>
              <Label for="member-name">Add household member</Label><Input
                id="member-name"
                required
                maxlength={200}
                bind:value={memberName}
                placeholder="Member name"
              />
            </div>
            <Button
              type="submit"
              color="primary"
              outline
              disabled={memberBusy || mutationBusy || importBusy}
              >{memberBusy ? 'Adding...' : 'Add member'}</Button
            >
          </Form>
          {#if memberError}<Alert color="danger" fade={false}>{memberError}</Alert>{/if}
          <StorageMeter {revision} />
          <div class="mt-3">
            <Button color="primary" outline disabled={backupBusy} on:click={downloadDatabase}>
              {backupBusy ? 'Preparing database...' : 'Download SQLite database'}
            </Button>
            <p class="muted small mt-2 mb-0">
              Full server backup: includes every household, archived records and private statement
              documents, not just this household. Store it securely. The live database is unchanged.
            </p>
            {#if backupError}<Alert color="danger" class="mt-2" fade={false}
                >Database download failed. {backupError}</Alert
              >{/if}
          </div>
        </Card>
        <footer>
          Built for a little more peace of mind. <span
            >Manual data · Central SQLite · No authentication yet</span
          >
        </footer>
      {/if}
    </main>
  </div>
</div>
