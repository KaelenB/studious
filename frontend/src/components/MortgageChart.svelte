<script lang="ts">
  import type { MortgageProjection, MortgageTerms } from '../lib/api';
  import { cents } from '../lib/money';
  import TimeChart, { type ChartSeries } from './TimeChart.svelte';

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

  const definitions: Omit<ChartSeries, 'values'>[] = [
    { key: 'balance', label: 'Balance', color: '#1d6251', area: true },
    { key: 'baseline', label: 'Without prepayments', color: '#7b8d88', dashed: true },
    { key: 'equity', label: 'Home equity', color: '#b7791f' },
    { key: 'property', label: 'Property value', color: '#d9a441', dashed: true },
    { key: 'principal', label: 'Principal repaid', color: '#2b6cb0' },
    { key: 'interest', label: 'Interest paid', color: '#c0392b' },
  ];
  const amount = (value: string) => Number(cents(value));

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

  const series = $derived(
    definitions
      .filter((definition) => definition.key in points[0]!.values)
      .map((definition) => ({
        ...definition,
        values: points.map((point) => point.values[definition.key as Key] ?? 0),
      })),
  );
  const todayIndex = $derived.by(() => {
    const year = Number(projection.asOf.slice(0, 4));
    const index = points.findIndex((point, i) => i > 0 && point.year >= year);
    return index < 0 ? null : index;
  });
</script>

<div class="mortgage-chart">
  <TimeChart
    labels={points.map((point) => point.label)}
    axisLabels={[String(points[0]!.year), String(points.at(-1)!.year)]}
    {series}
    {currency}
    marker={todayIndex}
    legendLabel="Chart lines"
    ariaLabel="Mortgage projection by year"
    caption="Hover, tap or use the arrow keys for values at each year-end; the marker is this year"
  />
</div>
