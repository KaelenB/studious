<script lang="ts">
  import { Alert, Button, Card, Form, Input, Label } from '@sveltestrap/sveltestrap';
  import { api, errorMessage, type Household } from '../lib/api';
  let { onopen }: { onopen: (household: Household) => Promise<void> } = $props();
  let name = $state('');
  let currency = $state('CAD');
  let existing = $state('');
  let busy = $state(false);
  let error = $state('');
  let created = $state<Household | null>(null);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      created = await api.createHousehold(name.trim(), currency);
      await onopen(created);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await onopen(await api.household(existing.trim()));
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section class="setup">
  <div class="eyebrow">A clearer financial picture</div>
  <h1>A home for your<br />household finances.</h1>
  <p class="intro">
    Bring your accounts together. Record where you stand today, and build a clearer picture over
    time.
  </p>
  {#if error}<Alert color="danger" fade={false}>{error}</Alert>{/if}
  {#if created}
    <Alert color="warning" fade={false}
      >Household created. Save this ID to reconnect: <code>{created.id}</code></Alert
    >
    <Button
      color="primary"
      disabled={busy}
      on:click={async () => {
        busy = true;
        try {
          await onopen(created!);
        } catch (cause) {
          error = errorMessage(cause);
        } finally {
          busy = false;
        }
      }}>Open created household</Button
    >
  {:else}
    <div class="setup-grid">
      <Card
        ><Form on:submit={create}>
          <h2>Start your household</h2>
          <Label for="household-name">Household name</Label>
          <Input
            id="household-name"
            bind:value={name}
            maxlength={200}
            required
            placeholder="e.g. Our household"
          />
          <Label for="household-currency">Default currency</Label>
          <Input type="select" id="household-currency" bind:value={currency}>
            <option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option>
          </Input>
          <Button type="submit" color="primary" disabled={busy}
            >{busy ? 'Connecting...' : 'Create household'}</Button
          >
        </Form></Card
      >
      <Card
        ><Form on:submit={connect}>
          <h2>Pick up where you left off</h2>
          <p>Already have a household? Connect using its ID.</p>
          <Label for="existing-household">Household ID</Label>
          <Input
            id="existing-household"
            bind:value={existing}
            required
            pattern={'[0-9a-fA-F\\-]{36}'}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <Button type="submit" color="primary" outline disabled={busy}>Connect household</Button>
        </Form></Card
      >
    </div>
  {/if}
  <p class="fineprint">
    Local-only preview. Household IDs are not passwords or access controls. Authentication is not
    yet available.
  </p>
</section>
