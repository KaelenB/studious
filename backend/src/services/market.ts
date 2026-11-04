import { z } from 'zod';

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            currency: z.string(),
            instrumentType: z.string(),
            longName: z.string().optional(),
            shortName: z.string().optional(),
          }),
          timestamp: z.array(z.number()),
          indicators: z.object({
            adjclose: z.array(z.object({ adjclose: z.array(z.number().nullable()) })),
            quote: z.array(z.object({ close: z.array(z.number().nullable()) })),
          }),
        }),
      )
      .nullable(),
  }),
});

export function createMarketHistory(transport: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: Promise<MarketHistory> }>();
  return (symbol: string, currency: string, asOf: string): Promise<MarketHistory> => {
    if (!/^[A-Z0-9][A-Z0-9.^=-]{0,39}$/.test(symbol))
      return Promise.reject(new Error('Unsupported ticker format; no lookup performed.'));
    const key = `${symbol}:${currency}:${asOf}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      const end = new Date(`${asOf}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      if (end > today) end.setTime(today.getTime());
      const start = new Date(end);
      start.setUTCFullYear(start.getUTCFullYear() - 5);
      const query = new URLSearchParams({
        period1: String(Math.floor(start.getTime() / 1000)),
        period2: String(Math.floor(end.getTime() / 1000)),
        interval: '1d',
      });
      const response = await transport(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,
        {
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error(`Market provider returned HTTP ${response.status}.`);
      if (!response.body) throw new Error('Market provider returned an empty response.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1_000_000) {
            await reader.cancel();
            throw new Error('Market provider response exceeded the size limit.');
          }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      const parsed = chartSchema.safeParse(JSON.parse(text));
      if (!parsed.success)
        throw new Error('Market provider returned an unsupported history response.');
      const result = parsed.data.chart.result?.[0];
      if (!result) throw new Error('Ticker was not found by the market provider.');
      if (
        result.meta.symbol.toUpperCase() !== symbol ||
        result.meta.currency !== currency ||
        !['ETF', 'EQUITY'].includes(result.meta.instrumentType)
      )
        throw new Error('Ticker, trading currency or stock/ETF classification did not match.');
      const samples = result.timestamp
        .map((time, index) => ({
          time,
          adjusted: result.indicators.adjclose[0]?.adjclose[index],
          close: result.indicators.quote[0]?.close[index],
        }))
        .filter(
          (point) =>
            point.time >= start.getTime() / 1000 &&
            point.time < end.getTime() / 1000 &&
            point.adjusted != null &&
            point.adjusted > 0 &&
            point.close != null &&
            point.close > 0,
        )
        .sort((a, b) => a.time - b.time);
      const first = samples[0];
      const last = samples.at(-1);
      if (!first || !last || (last.time - first.time) / 86400 < 365 * 3)
        throw new Error('At least three years of adjusted market history are required.');
      if ((end.getTime() / 1000 - last.time) / 86400 > 45)
        throw new Error('Market history is stale for the requested date.');
      return {
        marketName: result.meta.longName ?? result.meta.shortName ?? symbol,
        price: last.close!,
        priceCurrency: result.meta.currency,
        priceDate: new Date(last.time * 1000).toISOString().slice(0, 10),
        historyStart: new Date(first.time * 1000).toISOString().slice(0, 10),
        annualReturn:
          ((last.adjusted! / first.adjusted!) ** ((365.25 * 86400) / (last.time - first.time)) -
            1) *
          100,
      };
    })();
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 6 * 60 * 60 * 1000 });
    void value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  };
}

export interface MarketHistory {
  marketName: string;
  price: number;
  priceCurrency: string;
  priceDate: string;
  historyStart: string;
  annualReturn: number;
}
