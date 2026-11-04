<script lang="ts">
  import { Table } from '@sveltestrap/sveltestrap';
  import type { StatementInvestment } from '@studious/api';
  import { cents, formatMoney } from '../lib/money';

  let {
    investments,
    currency,
    date,
  }: {
    investments: StatementInvestment[];
    currency: string;
    date: string;
  } = $props();
</script>

<div aria-label="Statement investments">
  <h5>My investments · {date}</h5>
  <Table responsive aria-label="Investment breakdown">
    <thead
      ><tr
        ><th>Investment name</th><th>Category</th><th>Number of units</th><th>Unit price</th><th
          >Value</th
        ></tr
      ></thead
    >
    <tbody
      >{#each investments as investment}<tr>
          <td class="text-break"
            >{#if investment.symbol}<strong>{investment.symbol}</strong><br
              />{/if}{investment.name}</td
          >
          <td>{investment.category ?? 'Not specified'}</td>
          <td class="text-nowrap">{investment.units}</td>
          <td class="text-nowrap">{investment.currency ?? currency} {investment.unitPrice}</td>
          <td class="text-nowrap"
            >{formatMoney(cents(investment.value), investment.currency ?? currency)}</td
          >
        </tr>{/each}</tbody
    >
  </Table>
  <p class="muted small">
    Historical statement values, not live holdings. These rows describe the plan balance; they are
    not added to net worth a second time. Units and prices retain the export's precision.
  </p>
</div>
