<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Alert, Button, Card, Form, Input, Label, Spinner } from '@sveltestrap/sveltestrap';
  import {
    budgetFileLimit,
    type BudgetPreview,
    type BudgetMemberMapping,
    type Household,
    type Member,
  } from '@studious/api';
  import { api, errorMessage } from '../lib/api';
  import { cents, formatMoney } from '../lib/money';

  let {
    household,
    members,
    disabled = false,
    onbusy,
    onimport,
  }: {
    household: Household;
    members: Member[];
    disabled?: boolean;
    onbusy: (busy: boolean) => void;
    onimport: () => Promise<void>;
  } = $props();
  let file = $state<File | null>(null);
  let currency = $state(untrack(() => household.defaultCurrency));
  let preview = $state<BudgetPreview | null>(null);
  let mapping = $state<Record<string, string>>({});
  let reviewed = $state(false);
  let busy = $state(false);
  let error = $state('');
  let success = $state('');
  let controller: AbortController | undefined;
  const duplicates = $derived(preview?.rows.filter((row) => row.duplicate).length ?? 0);
  const additions = $derived(
    (['Expenses', 'Income'] as const).map((sheet) => {
      const rows = preview?.rows.filter((row) => row.sheet === sheet && !row.duplicate) ?? [];
      return {
        sheet,
        count: rows.length,
        amount: rows.reduce((sum, row) => sum + cents(row.amount), 0n),
      };
    }),
  );
  const locked = $derived(disabled || busy);
  const ready = $derived(
    preview &&
      !preview.issues.length &&
      reviewed &&
      preview.owners.every((owner) => mapping[owner]) &&
      preview.rows.length > duplicates,
  );
  onDestroy(() => controller?.abort());

  function reset() {
    preview = null;
    reviewed = false;
    error = '';
    success = '';
  }
  function setBusy(value: boolean) {
    busy = value;
    onbusy(value);
  }
  async function review(event: SubmitEvent) {
    event.preventDefault();
    if (!file) {
      error = 'Choose a budget workbook first.';
      return;
    }
    if (!file.size || file.size > budgetFileLimit) {
      error = 'Choose an XLSX no larger than 10 MiB.';
      return;
    }
    controller?.abort();
    const current = new AbortController();
    controller = current;
    reset();
    setBusy(true);
    try {
      const result = await api.previewBudget(
        household.id,
        file,
        file.name,
        currency,
        current.signal,
      );
      if (current.signal.aborted) return;
      preview = result;
      mapping = Object.fromEntries(
        result.owners.map((owner) => {
          const matches = members.filter(
            (member) => member.name.toLowerCase() === owner.toLowerCase(),
          );
          return [owner, matches.length === 1 ? matches[0]!.id : matches.length ? '' : 'CREATE'];
        }),
      );
    } catch (cause) {
      if (!current.signal.aborted) error = errorMessage(cause);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  async function confirm() {
    if (!file || !preview || !ready) return;
    setBusy(true);
    error = '';
    try {
      const targets: BudgetMemberMapping = Object.fromEntries(
        preview.owners.map((owner) => [owner, mapping[owner] === 'SHARED' ? null : mapping[owner]]),
      );
      const result = await api.importBudget(
        household.id,
        file,
        file.name,
        currency,
        preview.sha256,
        targets,
      );
      preview = null;
      reviewed = false;
      success = `Imported ${result.expenses} expenses and ${result.income} income entries. Skipped ${result.duplicates} previously imported rows.`;
      await onimport();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      setBusy(false);
    }
  }
</script>

<Card id="historical" role="region" aria-label="Historical budget import">
  <h2>Import historical budgets</h2>
  <p class="muted small">
    Upload each yearly XLSX, one at a time. Only the Expenses and Income transaction sheets are
    read, never summary tabs. Nothing is saved until you review and confirm.
  </p>
  <Form class="ledger-fields align-items-end mb-3" on:submit={review}>
    <div>
      <Label for="budget-file">Budget workbook (XLSX)</Label><Input
        id="budget-file"
        type="file"
        accept=".xlsx"
        disabled={locked}
        on:change={(event: Event) => {
          file = (event.target as HTMLInputElement).files?.[0] ?? null;
          reset();
        }}
      />
    </div>
    <div>
      <Label for="budget-currency">Workbook currency</Label><Input
        id="budget-currency"
        maxlength={3}
        minlength={3}
        pattern={'[A-Z]{3}'}
        required
        bind:value={currency}
        disabled={locked}
        on:change={reset}
      />
    </div>
    <Button type="submit" color="primary" outline disabled={locked || !file}
      >Preview workbook</Button
    >
  </Form>
  {#if busy}<p role="status"><Spinner size="sm" class="me-2" />Processing workbook...</p>{/if}
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  {#if success}<Alert color="success" fade={false}>{success}</Alert>{/if}
  {#if preview}
    <div aria-label="Budget workbook review">
      <h3>Review {file?.name}</h3>
      <p>{preview.rows.length} valid rows; {duplicates} already imported and will be skipped.</p>
      <div class="d-flex flex-wrap gap-3 mb-3">
        {#each preview.totals as total}<div>
            <strong>{total.sheet}: {formatMoney(cents(total.amount), preview.currency)}</strong>
            <div class="muted small">{total.count} source entries, including duplicates</div>
          </div>{/each}
      </div>
      <div class="d-flex flex-wrap gap-3 mb-3" aria-label="New import totals">
        {#each additions as total}
          <div>
            <strong>Will add {total.count} {total.sheet.toLowerCase()} entries</strong>
            <div>{formatMoney(total.amount, preview.currency)} excluding duplicates</div>
          </div>
        {/each}
      </div>
      <p class="muted small">
        Dates are taken from the cells, not the filename. Negative expenses are refunds. Additional
        decimal places are rounded to the nearest cent and flagged below. Income is recorded as-is
        (including reimbursements or savings transfers), not classified as salary. Imported entries
        do not alter account balances.
      </p>
      {#if preview.issues.length}
        <Alert color="danger" fade={false}
          >Fix all {preview.issues.length} invalid rows and preview again. No partial import is allowed.
          <ul>
            {#each preview.issues as issue}<li>
                {issue.sheet} row {issue.row}: {issue.message}
              </li>{/each}
          </ul>
        </Alert>
      {/if}
      {#if preview.warnings.length}
        <Alert color="warning" fade={false}
          ><strong>Review {preview.warnings.length} warnings</strong>
          <ul>
            {#each preview.warnings as warning}<li>{warning}</li>{/each}
          </ul></Alert
        >
      {/if}
      <fieldset disabled={locked} class="mb-3">
        <legend class="h6">Match spreadsheet names to household members</legend>
        <div class="ledger-fields">
          {#each preview.owners as owner, index}
            <div>
              <Label for={`budget-owner-${index}`}>{owner}</Label><Input
                id={`budget-owner-${index}`}
                type="select"
                bind:value={mapping[owner]}
                on:change={() => (reviewed = false)}
              >
                <option value="">Choose a member</option>
                <option value="CREATE">Create or reuse member named {owner}</option>
                <option value="SHARED">Shared household</option>
                {#each members as member}<option value={member.id}>{member.name}</option>{/each}
              </Input>
            </div>
          {/each}
        </div>
      </fieldset>
      <details class="mb-3">
        <summary>Review all source rows</summary>
        <div class="import-review-table table-responsive">
          <table class="table table-sm">
            <thead
              ><tr
                ><th scope="col">Sheet / row</th><th scope="col">Date</th><th scope="col"
                  >Description</th
                ><th scope="col">Category</th><th scope="col">Member</th><th scope="col">Amount</th
                ><th scope="col">Status</th></tr
              ></thead
            >
            <tbody
              >{#each preview.rows as row}<tr
                  ><td>{row.sheet} / {row.row}</td><td>{row.date}</td><td>{row.name}</td><td
                    >{row.category ?? 'Uncategorized'}</td
                  ><td>{row.owner}</td><td class="numeric"
                    >{formatMoney(cents(row.amount), preview.currency)}</td
                  ><td>{row.duplicate ? 'Skip duplicate' : 'New'}</td></tr
                >{/each}</tbody
            >
          </table>
        </div>
      </details>
      <label class="d-flex gap-2 align-items-start mb-3"
        ><input type="checkbox" bind:checked={reviewed} disabled={locked} />I reviewed the dates,
        currency, rounding warnings and member mapping.</label
      >
      <Button color="primary" disabled={locked || !ready} on:click={confirm}>Confirm import</Button>
      <Button color="link" disabled={locked} on:click={reset}>Cancel review</Button>
      <p class="muted small mt-2">
        Re-imports skip identical imported rows, even in renamed or overlapping workbooks. Identical
        repeated rows within one sheet are preserved by occurrence count. Edited source rows are new
        entries; correct existing records in the app rather than re-importing edits. Manually
        entered records are not auto-matched. Archived imported records stay marked as imported.
      </p>
    </div>
  {/if}
</Card>
