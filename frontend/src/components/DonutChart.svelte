<script lang="ts">
  import { formatMoney } from '../lib/money';

  let {
    items,
    currency,
    ariaLabel,
    centerLabel = 'Total',
  }: {
    /** Positive cents per slice; zero and negative slices are left out. */
    items: { key: string; label: string; value: number; color: string }[];
    currency: string;
    ariaLabel: string;
    centerLabel?: string;
  } = $props();

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const slices = $derived(items.filter((item) => item.value > 0));
  const total = $derived(slices.reduce((sum, item) => sum + item.value, 0));
  const money = (value: number) => formatMoney(BigInt(Math.round(value)), currency);
  const compact = (value: number) =>
    new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value / 100);
  const share = (value: number) =>
    new Intl.NumberFormat('en-CA', { style: 'percent', maximumFractionDigits: 1 }).format(
      total ? value / total : 0,
    );
  /** Arc length and starting offset of each slice around the ring. */
  const arcs = $derived.by(() => {
    let offset = 0;
    return slices.map((item) => {
      const length = total ? (item.value / total) * circumference : 0;
      const arc = { item, length, offset };
      offset += length;
      return arc;
    });
  });
  let active = $state<string | null>(null);
</script>

<figure class="donut-chart">
  <svg
    viewBox="0 0 100 100"
    role="img"
    aria-label={`${ariaLabel}: ${slices.map((item) => `${item.label} ${money(item.value)} (${share(item.value)})`).join(', ')}`}
  >
    <circle cx="50" cy="50" r={radius} class="donut-track" />
    {#each arcs as { item, length, offset } (item.key)}
      <circle
        cx="50"
        cy="50"
        r={radius}
        role="presentation"
        class="donut-slice"
        class:active={active === item.key}
        style:--series={item.color}
        stroke-dasharray={`${Math.max(0, length - (arcs.length > 1 ? 0.8 : 0))} ${circumference}`}
        stroke-dashoffset={-offset}
        transform="rotate(-90 50 50)"
        onpointerenter={() => (active = item.key)}
        onpointerleave={() => (active = null)}
      />
    {/each}
    <text x="50" y="47" text-anchor="middle" class="donut-center">{centerLabel}</text>
    <text x="50" y="59" text-anchor="middle" class="donut-total">{compact(total)}</text>
  </svg>
  <ul class="donut-legend">
    {#each slices as item (item.key)}
      <li
        class:active={active === item.key}
        style:--series={item.color}
        onpointerenter={() => (active = item.key)}
        onpointerleave={() => (active = null)}
      >
        <span class="swatch" aria-hidden="true"></span>
        <span>{item.label}</span>
        <span class="donut-value">{money(item.value)}</span>
        <span class="donut-share">{share(item.value)}</span>
      </li>
    {/each}
  </ul>
</figure>
