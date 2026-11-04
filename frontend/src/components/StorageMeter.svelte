<script lang="ts">
  import { Progress } from '@sveltestrap/sveltestrap';
  import { api } from '../lib/api';

  let { revision = 0 }: { revision?: number } = $props();
  let usage = $state<{ usedBytes: number; limitBytes: number } | null>(null);

  function size(bytes: number) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    return `${Math.ceil(bytes / 1024)} KiB`;
  }

  $effect(() => {
    void revision;
    const controller = new AbortController();
    api.storage(controller.signal).then(
      (next) => (usage = next),
      () => (usage = null),
    );
    return () => controller.abort();
  });
</script>

{#if usage}
  <div class="storage-meter">
    <span class="muted small"
      >Shared database: {size(usage.usedBytes)} of {size(usage.limitBytes)} used</span
    >
    <Progress
      value={Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)}
      aria-label="Database storage used"
    />
  </div>
{/if}

<style>
  .storage-meter {
    display: grid;
    gap: 0.35rem;
    margin-top: 1.25rem;
  }
</style>
