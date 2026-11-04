<script lang="ts">
  import { Alert, Button, Form, Input, Label, Spinner, Table } from '@sveltestrap/sveltestrap';
  import {
    statementFileLimit,
    type Account,
    type StatementArchive,
    type StatementPreview,
  } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { cents, formatMoney } from '../lib/money';
  import StatementInvestments from './StatementInvestments.svelte';

  let {
    account,
    disabled,
    onimport,
  }: {
    account: Account;
    disabled: boolean;
    onimport: (file: File, statementDate?: string) => Promise<void>;
  } = $props();
  let files = $state<FileList | undefined>(undefined);
  let reviewedFile = $state<File | null>(null);
  let preview = $state<StatementPreview | null>(null);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let archives = $state<StatementArchive[]>([]);
  let archiveError = $state('');
  let offset = $state(0);
  let hasMore = $state(false);
  let loading = $state(true);
  let version = $state(0);
  let inputVersion = $state(0);
  let previewController: AbortController | undefined;
  let observationDate = $state('');
  const isXlsx = $derived(/\.xlsx$/i.test(files?.[0]?.name ?? ''));

  $effect(() => {
    const currentOffset = offset;
    version;
    const householdId = account.householdId;
    const accountId = account.id;
    const controller = new AbortController();
    loading = true;
    archiveError = '';
    api
      .statements(householdId, accountId, 21, currentOffset, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        archives = rows.slice(0, 20);
        hasMore = rows.length > 20;
      })
      .catch((cause) => {
        if (!controller.signal.aborted) archiveError = errorMessage(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });
  $effect(() => () => previewController?.abort());

  function changed() {
    preview = null;
    reviewedFile = null;
    error = '';
    notice = '';
  }

  async function review(event: SubmitEvent) {
    event.preventDefault();
    preview = null;
    reviewedFile = null;
    error = '';
    notice = '';
    const file = files?.[0];
    if (
      !file ||
      !/\.(?:pdf|xlsx)$/i.test(file.name) ||
      !file.size ||
      file.size > statementFileLimit
    ) {
      error = 'Choose a PDF or XLSX no larger than 10 MiB.';
      return;
    }
    busy = true;
    const controller = new AbortController();
    previewController = controller;
    try {
      const parsed = await api.previewStatement(
        account.householdId,
        account.id,
        file.name,
        file,
        controller.signal,
        isXlsx ? observationDate : undefined,
      );
      if (controller.signal.aborted) return;
      preview = parsed;
      reviewedFile = file;
    } catch (cause) {
      if (!controller.signal.aborted) error = errorMessage(cause);
    } finally {
      if (!controller.signal.aborted) busy = false;
    }
  }

  async function confirm() {
    if (!reviewedFile || !preview) return;
    busy = true;
    error = '';
    try {
      await onimport(reviewedFile, preview.questrade ? preview.statementDate : undefined);
      notice = preview.questrade
        ? 'Snapshot saved and original XLSX archived.'
        : 'Snapshot saved and original PDF archived.';
      preview = null;
      reviewedFile = null;
      files = undefined;
      inputVersion++;
      offset = 0;
      version++;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function download(archive: StatementArchive) {
    busy = true;
    error = '';
    try {
      const blob = await api.downloadStatement(account.householdId, account.id, archive.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = archive.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
  async function extractInvestments(archive: StatementArchive) {
    busy = true;
    error = '';
    notice = '';
    try {
      const updated = await api.extractStatementInvestments(
        account.householdId,
        account.id,
        archive.id,
      );
      archives = archives.map((item) => (item.id === updated.id ? updated : item));
      notice =
        'Investment breakdown extracted from the archived export. No new balance snapshot was created.';
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section class="border-top pt-3 mt-4" aria-label="Investment statement imports">
  <h3>Investment statement import</h3>
  <p class="muted small">
    Upload a Canadian Sun Life PDF (up to 25 pages) or Questrade InvestmentSummary XLSX (one
    account), up to 10 MiB. Review balances and investments before saving. Parsing stays local.
    Scans and encrypted files are not supported.
  </p>
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  {#if notice}<Alert color="success" fade={false}>{notice}</Alert>{/if}
  <Form on:submit={review}>
    {#key inputVersion}<Label for="statement-file">Investment export (PDF or XLSX)</Label><Input
        id="statement-file"
        type="file"
        accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        bind:files
        on:change={changed}
        disabled={disabled || busy}
        required
      />{/key}
    {#if isXlsx}
      <Label class="mt-2" for="statement-observation-date">Questrade observation date</Label>
      <Input
        id="statement-observation-date"
        type="date"
        min="1000-01-01"
        max="9999-12-31"
        required
        bind:value={observationDate}
        on:change={changed}
        disabled={disabled || busy}
      />
      <p class="muted small">
        This export has no valuation date. Enter the date these values were observed; it is not
        inferred from upload time.
      </p>
    {/if}
    <Button class="mt-2" type="submit" color="primary" outline disabled={disabled || busy}
      >{busy ? 'Processing...' : 'Review export'}</Button
    >
  </Form>
  {#if preview && reviewedFile}
    <div class="border rounded p-3 mt-3" aria-label="Statement review">
      <h4>Review detected snapshot</h4>
      <p class="text-break">{reviewedFile.name}</p>
      <p>
        Account: <strong>{account.name}</strong><br />Statement date:
        <strong>{preview.statementDate}</strong><br />Closing balance:
        <strong>{formatMoney(cents(preview.amount), preview.currency)}</strong>
      </p>
      <p class="muted small">
        This is the total account value, not a contribution or an individual fund. Confirm the
        export belongs to this account. The date is stored as end-of-day UTC; no bank connection or
        live exchange-rate lookup is involved.
      </p>
      {#if preview.questrade}
        <p>
          Questrade · {preview.questrade.accountType}<br />
          Cash: {formatMoney(cents(preview.questrade.cashCAD), 'CAD')} / {formatMoney(
            cents(preview.questrade.cashUSD),
            'USD',
          )}<br />
          Combined cash: {formatMoney(cents(preview.questrade.combinedCashCAD), 'CAD')}<br />
          Export FX rate: {preview.questrade.fxRate} CAD per USD
        </p>
        <p class="muted small">
          Snapshot uses the export's CAD-combined total equity, including cash. Position prices and
          values remain in their native currencies.
        </p>
      {/if}
      {#if preview.investments}
        <StatementInvestments
          investments={preview.investments}
          currency={preview.currency}
          date={preview.statementDate}
        />
      {:else}
        <Alert color="warning" fade={false}
          >No investment positions were found. This import contains only the account balance.</Alert
        >
      {/if}
      <Button color="primary" disabled={disabled || busy} on:click={confirm}
        >Confirm snapshot and archive export</Button
      >
      <Button class="ms-2" color="secondary" outline disabled={disabled || busy} on:click={changed}
        >Cancel import</Button
      >
    </div>
  {/if}
  <h4 class="mt-4">Archived statements</h4>
  {#each archives as archive (archive.id)}
    <details class="border rounded p-3 mb-2">
      <summary class="text-break"
        >Investment details · {archive.provider} · {archive.statementDate} · {archive.filename}</summary
      >
      {#if archive.investments}
        {#if archive.questrade}
          <p>
            Cash: {formatMoney(cents(archive.questrade.cashCAD), 'CAD')} / {formatMoney(
              cents(archive.questrade.cashUSD),
              'USD',
            )}; export FX: {archive.questrade.fxRate} CAD per USD.
          </p>
        {/if}
        <StatementInvestments
          investments={archive.investments}
          currency={archive.currency}
          date={archive.statementDate}
        />
      {:else}
        <p class="muted small mt-2">
          No investment breakdown is stored for this archive. Extract it from the original export if
          it was imported before this feature.
        </p>
        <Button
          color="primary"
          outline
          disabled={disabled || busy}
          on:click={() => void extractInvestments(archive)}
          >Extract investments from archived export</Button
        >
      {/if}
    </details>
  {/each}
  {#if archiveError}<Alert color="danger" fade={false}
      >Could not load the statement archive. {archiveError}
      <Button color="link" on:click={() => version++}>Retry archive</Button></Alert
    >{/if}
  {#if loading}<p role="status"><Spinner size="sm" /> Loading archived statements...</p>
  {:else if !archiveError && !archives.length}<p class="muted">No archived statements yet.</p>{/if}
  {#if archives.length}
    <Table responsive aria-label="Statement archive"
      ><thead><tr><th>Statement date</th><th>Balance</th><th>Original document</th></tr></thead>
      <tbody
        >{#each archives as archive (archive.id)}<tr
            ><td class="text-nowrap">{archive.statementDate}</td><td class="text-nowrap"
              >{formatMoney(cents(archive.amount), archive.currency)}</td
            ><td
              ><Button
                color="link"
                class="text-break text-start"
                disabled={disabled || busy}
                on:click={() => void download(archive)}>Download {archive.filename}</Button
              ></td
            ></tr
          >{/each}</tbody
      >
    </Table>
  {/if}
  {#if offset || hasMore}<div class="d-flex flex-wrap gap-2">
      <Button
        color="primary"
        outline
        disabled={loading || busy || offset === 0}
        on:click={() => (offset -= 20)}>Newer statements</Button
      ><Button
        color="primary"
        outline
        disabled={loading || busy || !hasMore}
        on:click={() => (offset += 20)}>Older statements</Button
      >
    </div>{/if}
</section>
