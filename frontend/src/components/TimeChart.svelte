<script lang="ts" module>
  export interface ChartSeries {
    key: string;
    label: string;
    color: string;
    /** Cents per point; null leaves a gap (treated as zero when stacked). */
    values: (number | null)[];
    dashed?: boolean;
    /** Shade the area under a line (line mode only). */
    area?: boolean;
  }
</script>

<script lang="ts">
  import { formatMoney } from '../lib/money';

  let {
    labels,
    series,
    currency,
    ariaLabel,
    caption,
    mode = 'line',
    marker = null,
    totalLabel = 'Total',
    legendLabel = 'Chart series',
    height: plotHeight = '14rem',
    axisLabels,
    categoryAxis = false,
  }: {
    /** Tooltip heading for each point; the first and last also label the x-axis. */
    labels: string[];
    series: ChartSeries[];
    currency: string;
    ariaLabel: string;
    caption: string;
    /** `stack` stacks areas, `bars` stacks columns; both add a total to the tooltip. */
    mode?: 'line' | 'stack' | 'bars';
    /** Index highlighted as "now" and selected first on keyboard focus. */
    marker?: number | null;
    totalLabel?: string;
    legendLabel?: string;
    height?: string;
    /** Start and end x-axis labels; defaults to the first and last point labels. */
    axisLabels?: [string, string];
    categoryAxis?: boolean;
  } = $props();

  const width = 600;
  const height = 220;
  const count = $derived(labels.length);
  const money = (value: number) => formatMoney(BigInt(Math.round(value)), currency);
  const compact = (value: number) =>
    new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value / 100);

  let hidden = $state<Record<string, boolean>>({});
  const visible = $derived(series.filter((item) => !hidden[item.key]));
  const stacked = $derived(mode !== 'line');

  /** Lower and upper bound of each visible series at each point once stacked. */
  const layers = $derived.by(() => {
    const positive = Array.from({ length: count }, () => 0);
    const negative = Array.from({ length: count }, () => 0);
    return visible.map((item) => {
      const lower = Array.from({ length: count }, (_, index) =>
        !stacked ? 0 : (item.values[index] ?? 0) < 0 ? negative[index]! : positive[index]!,
      );
      const upper = lower.map((value, index) => value + (item.values[index] ?? 0));
      if (stacked)
        upper.forEach((value, index) => {
          if ((item.values[index] ?? 0) < 0) negative[index] = value;
          else positive[index] = value;
        });
      return { item, lower, upper };
    });
  });
  const totals = $derived(
    Array.from({ length: count }, (_, index) =>
      visible.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
    ),
  );

  const scale = $derived.by(() => {
    const values = stacked
      ? layers.flatMap((layer) => [...layer.upper, ...layer.lower])
      : visible.flatMap((item) => item.values.filter((value): value is number => value !== null));
    const low = Math.min(0, ...values);
    const high = Math.max(0, ...values);
    const rough = Math.max(high - low, 100) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((s) => s >= rough)!;
    const bottom = Math.floor(low / step) * step;
    const top = Math.max(Math.ceil(high / step) * step, bottom + step);
    const ticks = Array.from(
      { length: Math.round((top - bottom) / step) + 1 },
      (_, index) => bottom + index * step,
    );
    return { bottom, top, ticks };
  });

  const span = $derived(Math.max(1, count - 1));
  /** Horizontal position as a fraction of the plot width; bars sit in the middle of a band. */
  const fraction = (index: number) =>
    mode === 'bars' ? (index + 0.5) / Math.max(1, count) : count === 1 ? 0.5 : index / span;
  const x = (index: number) => fraction(index) * width;
  const y = (value: number) =>
    height - ((value - scale.bottom) / (scale.top - scale.bottom)) * height;

  /** Runs of consecutive point indexes that have a value; a line breaks across gaps. */
  function runs(values: (number | null)[]) {
    const result: number[][] = [];
    let current: number[] = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (current.length) result.push(current);
        current = [];
      } else current.push(index);
    });
    if (current.length) result.push(current);
    return result;
  }
  const line = (values: (number | null)[], run: number[]) =>
    `M${run.map((index) => `${x(index)},${y(values[index] ?? 0)}`).join(' L')}`;
  const area = (values: (number | null)[], run: number[]) => {
    const floor = y(Math.max(0, scale.bottom));
    return `${line(values, run)} L${x(run.at(-1)!)},${floor} L${x(run[0]!)},${floor} Z`;
  };
  function band(lower: number[], upper: number[]) {
    const top = upper.map((value, index) => `${x(index)},${y(value)}`);
    const bottom = lower.map((value, index) => `${x(index)},${y(value)}`).reverse();
    return `M${[...top, ...bottom].join(' L')} Z`;
  }
  const barWidth = $derived(Math.min(48, (width / Math.max(1, count)) * 0.62));

  let active = $state<number | null>(null);
  const shown = $derived(active === null || count === 0 ? null : Math.min(active, count - 1));
  const valueAt = (item: ChartSeries, index: number) =>
    item.values[index] === null || item.values[index] === undefined
      ? '—'
      : money(item.values[index]!);
  const describe = (index: number) =>
    `${labels[index]}: ${visible.map((item) => `${item.label} ${valueAt(item, index)}`).join(', ')}${
      stacked ? `, ${totalLabel} ${money(totals[index] ?? 0)}` : ''
    }`;

  function pick(event: PointerEvent) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width;
    const index = mode === 'bars' ? Math.floor(position * count) : Math.round(position * span);
    active = Math.max(0, Math.min(count - 1, index));
  }

  function step(event: KeyboardEvent) {
    const current = shown ?? marker ?? count - 1;
    const next: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    active = Math.max(0, Math.min(count - 1, next[event.key]!));
  }
</script>

<figure class="time-chart">
  {#if series.length > 1}
    <div class="chart-legend" role="group" aria-label={legendLabel}>
      {#each series as item (item.key)}
        <button
          type="button"
          class="legend-item"
          style:--series={item.color}
          aria-pressed={!hidden[item.key]}
          onclick={() => (hidden = { ...hidden, [item.key]: !hidden[item.key] })}
        >
          <span class="swatch" class:dashed={item.dashed} class:block={stacked}></span>{item.label}
        </button>
      {/each}
    </div>
  {/if}
  <div class="chart-frame">
    <div class="chart-axis" aria-hidden="true">
      {#each scale.ticks as tick (tick)}
        <span style:bottom={`${((tick - scale.bottom) / (scale.top - scale.bottom)) * 100}%`}
          >{compact(tick)}</span
        >
      {/each}
    </div>
    <div
      class="chart-plot"
      style:height={plotHeight}
      role="slider"
      tabindex="0"
      aria-label={`${ariaLabel}. Use the arrow keys to read values.`}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={shown ?? marker ?? Math.max(0, count - 1)}
      aria-valuetext={count ? describe(shown ?? marker ?? count - 1) : 'No data'}
      onpointermove={pick}
      onpointerdown={pick}
      onpointerleave={(event) => {
        if (event.pointerType === 'mouse') active = null;
      }}
      onkeydown={step}
      onfocus={() => (active ??= marker ?? count - 1)}
      onblur={() => (active = null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {#each scale.ticks as tick (tick)}
          <line
            x1="0"
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
            class="grid-line"
            class:zero-line={tick === 0 && scale.bottom < 0}
          />
        {/each}
        {#if mode === 'bars'}
          {#each layers as { item, lower, upper } (item.key)}
            {#each upper as value, index (index)}
              {#if value !== lower[index]}
                <rect
                  x={x(index) - barWidth / 2}
                  width={barWidth}
                  y={Math.min(y(value), y(lower[index]!))}
                  height={Math.abs(y(lower[index]!) - y(value))}
                  class="series-bar"
                  class:negative={value < lower[index]!}
                  class:faded={shown !== null && shown !== index}
                  style:--series={item.color}
                />
              {/if}
            {/each}
          {/each}
        {:else if mode === 'stack'}
          {#each layers as { item, lower, upper } (item.key)}
            <path d={band(lower, upper)} class="series-band" style:--series={item.color} />
            <path
              d={`M${upper.map((value, index) => `${x(index)},${y(value)}`).join(' L')}`}
              class="series-line thin"
              style:--series={item.color}
            />
          {/each}
        {:else}
          {#each visible as item (item.key)}
            {#each runs(item.values) as run, index (index)}
              {#if run.length === 1}
                <circle cx={x(run[0]!)} cy={y(item.values[run[0]!]!)} r="3" fill={item.color} />
              {/if}
              {#if item.area}
                <path d={area(item.values, run)} class="series-area" style:--series={item.color} />
              {/if}
              <path
                d={line(item.values, run)}
                class="series-line"
                class:dashed={item.dashed}
                style:--series={item.color}
              />
            {/each}
          {/each}
        {/if}
        {#if marker !== null && mode !== 'bars'}
          <line x1={x(marker)} x2={x(marker)} y1="0" y2={height} class="today-line" />
        {/if}
        {#if shown !== null && mode !== 'bars'}
          <line x1={x(shown)} x2={x(shown)} y1="0" y2={height} class="active-line" />
        {/if}
      </svg>
      {#if shown !== null}
        {#if mode !== 'bars'}
          {#each layers as { item, upper } (item.key)}
            {#if item.values[shown] !== null && item.values[shown] !== undefined}
              <span
                class="chart-dot"
                style:--series={item.color}
                style:left={`${fraction(shown) * 100}%`}
                style:top={`${(y(upper[shown]!) / height) * 100}%`}
              ></span>
            {/if}
          {/each}
        {/if}
        <div
          class="chart-tooltip"
          class:flip={fraction(shown) > 0.55}
          style:left={`${fraction(shown) * 100}%`}
        >
          <strong>{labels[shown]}</strong>
          {#each stacked ? [...visible].reverse() : visible as item (item.key)}
            <span style:--series={item.color}>
              <span class="swatch" class:dashed={item.dashed} class:block={stacked}
              ></span>{item.label}
              <b>{valueAt(item, shown)}</b>
            </span>
          {/each}
          {#if stacked}
            <span class="tooltip-total">{totalLabel} <b>{money(totals[shown] ?? 0)}</b></span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  {#if categoryAxis}
    <div
      class="chart-category-axis muted"
      style:grid-template-columns={`repeat(${Math.max(1, count)}, minmax(0, 1fr))`}
      aria-hidden="true"
    >
      {#each labels as label, index (index)}<span>{label}</span>{/each}
    </div>
  {/if}
  <figcaption class="muted small" class:caption-only={categoryAxis}>
    {#if !categoryAxis}<span>{axisLabels?.[0] ?? labels[0]}</span>{/if}
    <span>{caption}</span>
    {#if !categoryAxis}<span>{axisLabels?.[1] ?? labels.at(-1)}</span>{/if}
  </figcaption>
</figure>
