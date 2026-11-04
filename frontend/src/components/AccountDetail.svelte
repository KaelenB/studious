<script lang="ts">
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
  import {
    accountKind,
    api,
    errorMessage,
    moneyPattern,
    type Account,
    type Snapshot,
  } from '../lib/api';
  import { cents, formatMoney, localDateTime } from '../lib/money';
  import Statements from './Statements.svelte';
  let {
    account,
    revision,
    onrecord,
    onedit,
    onarchive,
    onimport,
  }: {
    account: Account;
    revision: number;
    onrecord: (amount: string, asOf: string) => Promise<void>;
    onedit: () => void;
    onarchive: () => Promise<void>;
    onimport: (file: File, statementDate?: string) => Promise<void>;
  } = $props();
  let history = $state<Snapshot[]>([]);
  let offset = $state(0);
  let hasMore = $state(false);
  let loading = $state(true);
  let error = $state('');
  let amount = $state('');
  let asOf = $state(localDateTime());
  let busy = $state(false);
  let confirming = $state(false);
  let notice = $state('');
  let historyVersion = $state(0);

  $effect(() => {
    const id = account.id;
    const householdId = account.householdId;
    revision;
    historyVersion;
    const pageOffset = offset;
    const controller = new AbortController();
    loading = true;
    error = '';
    api
      .balances(householdId, id, 21, pageOffset, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        history = rows.slice(0, 20);
        hasMore = rows.length > 20;
      })
      .catch((cause) => {
        if (!controller.signal.aborted) error = errorMessage(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  async function record(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    if (!moneyPattern.test(amount)) {
      error = 'Enter a decimal amount with exactly two places (e.g. 1234.56).';
      return;
    }
    const date = new Date(asOf);
    if (Number.isNaN(date.getTime())) {
      error = 'Enter a valid observation date and time.';
      return;
    }
    busy = true;
    try {
      await onrecord(amount, date.toISOString());
      amount = '';
      notice = 'Balance recorded.';
      offset = 0;
      historyVersion++;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function archive() {
    busy = true;
    error = '';
    try {
      await onarchive();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function importStatement(file: File, statementDate?: string) {
    busy = true;
    try {
      await onimport(file, statementDate);
      offset = 0;
      historyVersion++;
    } finally {
      busy = false;
    }
  }
</script>

<Card class="detail" role="region" aria-label="Account details">
  <div class="section-heading">
    <div>
      <div class="eyebrow">{accountKind(account)}</div>
      <h2>{account.name}</h2>
    </div>
    <Button color="primary" outline disabled={busy} on:click={onedit}>Edit account</Button>
  </div>
  {#if error}<Alert color="danger" fade={false}>
      {error}
      <Button color="link" on:click={() => historyVersion++}>Retry history</Button>
    </Alert>{/if}
  {#if notice}<Alert color="success" fade={false}>{notice}</Alert>{/if}
  <Form on:submit={record}>
    <h3>Record a balance</h3>
    <p class="muted small">
      Positive credit, loan, and mortgage balances mean money owed. Negative balances mean a credit.
      Entries are snapshots, not transactions.
    </p>
    <Row class="g-3 mb-3">
      <Col md="6">
        <Label for="balance-amount">Balance ({account.currency})</Label><Input
          id="balance-amount"
          inputmode="decimal"
          required
          bind:value={amount}
          placeholder="0.00"
        />
      </Col>
      <Col md="6">
        <Label for="balance-date">Observed at (local time)</Label><Input
          id="balance-date"
          type="datetime-local"
          required
          bind:value={asOf}
        />
      </Col>
    </Row>
    <Button type="submit" color="primary" disabled={busy}
      >{busy ? 'Saving...' : 'Record balance'}</Button
    >
  </Form>
  <div class="section-heading history-heading">
    <h3>Balance history</h3>
    <Badge color="light" class="text-success border">Manual</Badge>
  </div>
  {#if loading}<p role="status"><Spinner size="sm" class="me-2" />Loading balance history...</p>
  {:else if history.length === 0}<p class="muted">
      No balance snapshots yet. Record your first balance above.
    </p>
  {:else}
    <Table responsive hover>
      <thead><tr><th>Observed</th><th class="numeric">Balance</th><th>Source</th></tr></thead><tbody
      >
        {#each history as snapshot (snapshot.id)}<tr
            ><td>{new Date(snapshot.asOf).toLocaleString('en-CA')}</td><td class="numeric"
              >{formatMoney(cents(snapshot.amount), account.currency)}</td
            ><td>{snapshot.source === 'MANUAL' ? 'Manual' : snapshot.source}</td></tr
          >{/each}
      </tbody>
    </Table>
    <div class="history-pagination">
      <Button
        color="primary"
        outline
        size="sm"
        disabled={loading || offset === 0}
        on:click={() => (offset = Math.max(0, offset - 20))}>Newer</Button
      ><span class="muted small">Entries {offset + 1}-{offset + history.length}</span><Button
        color="primary"
        outline
        size="sm"
        disabled={loading || !hasMore}
        on:click={() => (offset += 20)}>Older</Button
      >
    </div>
  {/if}
  {#if account.type === 'INVESTMENT' && account.currency === 'CAD' && account.balanceSource === 'MANUAL'}
    <Statements {account} disabled={busy} onimport={importStatement} />
  {/if}
  <div class="archive-area">
    {#if confirming}<p>
        Archive this account? Its balance history will be preserved, but it will leave this
        dashboard.
      </p>
      <Button color="danger" disabled={busy} on:click={archive}>Confirm archive</Button>
      <Button color="primary" outline disabled={busy} on:click={() => (confirming = false)}
        >Keep account</Button
      >
    {:else}<Button
        color="link"
        class="text-danger"
        disabled={busy}
        on:click={() => (confirming = true)}>Archive account</Button
      >{/if}
  </div>
</Card>
