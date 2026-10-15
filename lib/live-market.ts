import type { SpotQuote } from "./types";

export const SCAN_INTERVAL_HOURS = 4;
export const SCAN_MINUTE = 17;
export const QUOTE_REFRESH_MS = 30_000;
export const CANDLE_REFRESH_MS = 60_000;

/** Missing or aged quotes are never replaced with a research candle price. */
export function freshQuotePrice(quote: SpotQuote | undefined, symbol: string, now: number): number | null {
  if (!quote || quote.symbol !== symbol || !Number.isFinite(quote.price) || quote.price <= 0) return null;
  const age = now - Date.parse(quote.asOf);
  return Number.isFinite(age) && age >= -5_000 && age <= 120_000 ? quote.price : null;
}

/** Keep portfolio marks and the selected market available even with a full radar. */
export function quoteSubscription(visible: string[], active: string[], selected?: string): string[] {
  return [...new Set([...active, ...(selected ? [selected] : []), ...visible])].slice(0, 50).sort();
}

/** Nominal GitHub UTC schedule; hosted runners can start later than this slot. */
export function nextScheduledScan(now: number): Date {
  const next = new Date(now);
  next.setUTCMinutes(SCAN_MINUTE, 0, 0);
  if (next.getTime() <= now) next.setUTCHours(next.getUTCHours() + 1);
  while (next.getUTCHours() % SCAN_INTERVAL_HOURS !== 0) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}
