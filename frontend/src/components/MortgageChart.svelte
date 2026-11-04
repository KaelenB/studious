<script lang="ts">
  import type { MortgageProjection, MortgageTerms } from '../lib/api';
  import { cents, formatMoney } from '../lib/money';

  let {
    terms,
    projection,
    currency,
  }: { terms: MortgageTerms; projection: MortgageProjection; currency: string } = $props();

  type Key = 'balance' | 'baseline' | 'equity' | 'property' | 'principal' | 'interest';
  interface Point {
    label: string;
    year: number;
    values: Partial<Record<Key, number>>;
  }

  const definitions: { key: Key; label: string; dashed?: boolean }[] = [
    { key: 'balance', label: 'Balance' },
    { key: 'baseline', label: 'Without prepayments', dashed: true },
    { key: 'equity', label: 'Home equity' },
    { key: 'property', label: 'Property value', dashed: true },
    { key: 'principal', label: 'Principal repaid' },
    { key: 'interest', label: 'Interest paid' },
  ];
  const width = 600;
  const height = 220;
  const amount = (value: string) => Number(cents(value));
  const money = (value: number) => formatMoney(BigInt(Math.round(value)), currency);
  const compact = (value: number) =>
    new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value / 100);

  /** Start of the loan, then one point per year-end until both schedules are repaid. */
  const points = $derived.by((): Point[] => {
    const principal = amount(terms.principal);
    const property = terms.propertyValue ? amount(terms.propertyValue) : null;
    const showBaseline = projection.prepaid !== '0.00' || projection.interestSaved !== '0.00';
    const baseline = new Map(
      showBaseline
        ? projection.baseline.years.map((year) => [year.year, amount(year.endingBalance)])
        : [],
    );
    const actual = new Map(projection.years.map((year) => [year.year, year]));
    const years = [...new Set([...actual.keys(), ...baseline.keys()])].sort((a, b) => a - b);
    const withProperty = (balance: number) =>
      property === null ? {} : { equity: property - balance, property };
    const start: Point = {
      label: `Start (${terms.startDate})`,
      year: Number(terms.startDate.slice(0, 4)),
      values: {
        balance: principal,
        ...(baseline.size ? { baseline: principal } : {}),
        ...withProperty(principal),
        principal: 0,
        interest: 0,
      },
    };
    let interest = 0;
    let repaid = 0;
    let balance = principal;
    const yearEnds = years.map((year): Point => {
      const entry = actual.get(year);
      if (entry) {
        interest += amount(entry.interest);
        repaid += amount(entry.principal) + amount(entry.prepaid);
        balance = amount(entry.endingBalance);
      }
      return {
        label: `End of ${year}`,
        year,
        values: {
          balance,
          ...(baseline.size ? { baseline: baseline.get(year) ?? 0 } : {}),
          ...withProperty(balance),
          principal: repaid,
          interest,
        },
      };
    });
    return [start, ...yearEnds];
  });

  const available = $derived(definitions.filter((series) => series.key in points[0]!.values));
  let hidden = $state<Partial<Record<Key, boolean>>>({});
  const visible = $derived(available.filter((series) => !hidden[series.key]));

  const scale = $derived.by(() => {
    const largest = Math.max(
      1,
      ...points.flatMap((point) => visible.map((series) => point.values[series.key] ?? 0)),
    );
    const rough = largest / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough)!;
    const top = Math.ceil(largest / step) * step;
    return { top, ticks: Array.from({ length: top / step + 1 }, (_, index) => index * step) };
  });
  const span = $derived(Math.max(1, points.length - 1));
  const x = (index: number) => (index / span) * width;
  const y = (value: number) => height - (Math.max(0, value) / scale.top) * height;
  const path = (key: Key) =>
    points.map((point, index) => `${x(index)},${y(point.values[key] ?? 0)}`).join(' L');

  const todayIndex = $derived.by(() => {
    const year = Number(projection.asOf.slice(0, 4));
    const index = points.findIndex((point, i) => i > 0 && point.year >= year);
    return index < 0 ? null : index;
  });

  let active = $state<number | null>(null);
  const shown = $derived(active === null ? null : Math.min(active, points.length - 1));
  const describe = (point: Point) =>
    `${point.label}: ${visible
      .map((series) => `${series.label} ${money(point.values[series.key] ?? 0)}`)
      .join(', ')}`;

  function pick(event: PointerEvent) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fraction = (event.clientX - bounds.left) / bounds.width;
    active = Math.max(0, Math.min(points.length - 1, Math.round(fraction * span)));
  }

  function step(event: KeyboardEvent) {
    const current = shown ?? todayIndex ?? 0;
    const next: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: points.length - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    active = Math.max(0, Math.min(points.length - 1, next[event.key]!));
  }
</script>

<figure class="mortgage-chart">
  <div class="mortgage-legend" role="group" aria-label="Chart lines">
    {#each available as series (series.key)}
      <button
        type="button"
        class={`legend-item series-${series.key}`}
        aria-pressed={!hidden[series.key]}
        onclick={() => (hidden = { ...hidden, [series.key]: !hidden[series.key] })}
      >
        <span class="swatch" class:dashed={series.dashed}></span>{series.label}
      </button>
    {/each}
  </div>
  <div class="chart-frame">
    <div class="chart-axis" aria-hidden="true">
      {#each scale.ticks as tick (tick)}
        <span style:bottom={`${(tick / scale.top) * 100}%`}>{compact(tick)}</span>
      {/each}
    </div>
    <div
      class="chart-plot"
      role="slider"
      tabindex="0"
      aria-label="Mortgage projection by year. Use the arrow keys to read values."
      aria-valuemin={0}
      aria-valuemax={points.length - 1}
      aria-valuenow={shown ?? 0}
      aria-valuetext={describe(points[shown ?? 0]!)}
      onpointermove={pick}
      onpointerdown={pick}
      onpointerleave={(event) => {
        if (event.pointerType === 'mouse') active = null;
      }}
      onkeydown={step}
      onfocus={() => (active ??= todayIndex ?? 0)}
      onblur={() => (active = null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {#each scale.ticks as tick (tick)}
          <line x1="0" x2={width} y1={y(tick)} y2={y(tick)} class="grid-line" />
        {/each}
        {#if visible.some((series) => series.key === 'balance')}
          <path d={`M0,${height} L${path('balance')} L${width},${height} Z`} class="balance-area" />
        {/if}
        {#each visible as series (series.key)}
          <path
            d={`M${path(series.key)}`}
            class={`series-line series-${series.key}`}
            class:dashed={series.dashed}
          />
        {/each}
        {#if todayIndex !== null}
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1="0" y2={height} class="today-line" />
        {/if}
        {#if shown !== null}
          <line x1={x(shown)} x2={x(shown)} y1="0" y2={height} class="active-line" />
        {/if}
      </svg>
      {#if shown !== null}
        {@const point = points[shown]!}
        {#each visible as series (series.key)}
          <span
            class={`chart-dot series-${series.key}`}
            style:left={`${(shown / span) * 100}%`}
            style:top={`${(y(point.values[series.key] ?? 0) / height) * 100}%`}
          ></span>
        {/each}
        <div
          class="chart-tooltip"
          class:flip={shown / span > 0.55}
          style:left={`${(shown / span) * 100}%`}
        >
          <strong>{point.label}</strong>
          {#each visible as series (series.key)}
            <span class={`series-${series.key}`}>
              <span class="swatch" class:dashed={series.dashed}></span>{series.label}
              <b>{money(point.values[series.key] ?? 0)}</b>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <figcaption class="muted small">
    <span>{points[0]!.year}</span>
    <span
      >Hover, tap or use the arrow keys for values at each year-end; the marker is this year</span
    >
    <span>{points.at(-1)!.year}</span>
  </figcaption>
</figure>
