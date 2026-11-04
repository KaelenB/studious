<script lang="ts">
  import { untrack } from 'svelte';
  import { Alert, Button, Card, Col, Form, Input, Label, Row } from '@sveltestrap/sveltestrap';
  import {
    accountLabels,
    accountTypes,
    errorMessage,
    investmentSubtypes,
    subtypeDescriptions,
    subtypeLabels,
    type Account,
    type AccountInput,
    type InvestmentSubtype,
    type Member,
  } from '../lib/api';
  let {
    members,
    currency,
    account = null,
    onsave,
    oncancel,
  }: {
    members: Member[];
    currency: string;
    account?: Account | null;
    onsave: (input: AccountInput) => Promise<void>;
    oncancel: () => void;
  } = $props();
  let name = $state(untrack(() => account?.name ?? ''));
  let type = $state<Account['type']>(untrack(() => account?.type ?? 'CHEQUING'));
  let selectedCurrency = $state(untrack(() => account?.currency ?? currency));
  let memberId = $state(untrack(() => account?.memberId ?? ''));
  let subtype = $state<InvestmentSubtype | ''>(untrack(() => account?.subtype ?? ''));
  let busy = $state(false);
  let error = $state('');
  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await onsave({
        name: name.trim(),
        type,
        currency: selectedCurrency,
        memberId: memberId || null,
        subtype: type === 'INVESTMENT' ? subtype || null : null,
      });
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<Card class="form-panel">
  <Form on:submit={save}>
    <div class="section-heading">
      <h2>{account ? 'Edit account' : 'Add an account'}</h2>
      <Button type="button" color="link" disabled={busy} on:click={oncancel}>Cancel</Button>
    </div>
    {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
    <Row class="g-3 mb-3">
      <Col md="6">
        <Label for="account-name">Account name</Label><Input
          id="account-name"
          required
          maxlength={200}
          bind:value={name}
          placeholder="e.g. Everyday chequing"
        />
      </Col>
      <Col md="6">
        <Label for="account-member">Account owner</Label><Input
          type="select"
          id="account-member"
          bind:value={memberId}
          ><option value="">Shared household</option>{#each members as member}<option
              value={member.id}>{member.name}</option
            >{/each}</Input
        >
      </Col>
      <Col md="6">
        <Label for="account-type">Account type</Label><Input
          type="select"
          id="account-type"
          bind:value={type}
          disabled={!!account}
          >{#each accountTypes as value}<option {value}>{accountLabels[value]}</option
            >{/each}</Input
        >
      </Col>
      <Col md="6">
        <Label for="account-currency">Account currency</Label><Input
          id="account-currency"
          required
          pattern={'[A-Z]{3}'}
          maxlength={3}
          bind:value={selectedCurrency}
          disabled={!!account}
        />
      </Col>
      {#if type === 'INVESTMENT'}
        <Col md="6">
          <Label for="account-subtype">Investment sub-type</Label><Input
            type="select"
            id="account-subtype"
            bind:value={subtype}
            ><option value="">Not specified</option>{#each investmentSubtypes as value}<option
                {value}
                >{subtypeLabels[value] === subtypeDescriptions[value]
                  ? subtypeLabels[value]
                  : `${subtypeLabels[value]} \u2014 ${subtypeDescriptions[value]}`}</option
              >{/each}</Input
          >
        </Col>
      {/if}
    </Row>
    <p class="muted small">
      Manual balances only. {account
        ? 'Type and currency are fixed to preserve historical meaning.'
        : 'You can record an opening balance after adding the account.'}
    </p>
    <Button type="submit" color="primary" disabled={busy}
      >{busy ? 'Saving...' : 'Save account'}</Button
    >
  </Form>
</Card>
