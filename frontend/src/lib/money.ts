import type { AccountSummary } from './api';

export function cents(value: string): bigint {
  if (!/^-?\d+\.\d{2}$/.test(value)) throw new Error('Invalid decimal money value');
  const negative = value.startsWith('-');
  const digits = BigInt(value.replace('-', '').replace('.', ''));
  return negative ? -digits : digits;
}

export function formatMoney(value: bigint, currency: string) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'code' })
    .formatToParts(negative ? -whole : whole)
    .map((part) => {
      if (part.type === 'fraction') return fraction;
      if (part.type === 'integer' && whole === 0n && negative) return `-${part.value}`;
      return part.value;
    })
    .join('');
}

export function totals(summaries: AccountSummary[]) {
  const currencies = new Map<string, { assets: bigint; debts: bigint; missing: number }>();
  for (const { account, latest } of summaries) {
    const group = currencies.get(account.currency) ?? { assets: 0n, debts: 0n, missing: 0 };
    if (!latest) group.missing++;
    else if (['CREDIT', 'LOAN', 'MORTGAGE'].includes(account.type))
      group.debts += cents(latest.amount);
    else group.assets += cents(latest.amount);
    currencies.set(account.currency, group);
  }
  return [...currencies].map(([currency, group]) => ({
    currency,
    ...group,
    net: group.assets - group.debts,
  }));
}

export function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
