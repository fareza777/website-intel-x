import type { SpotQuote, Timeframe } from "./types";

export const SCAN_INTERVAL_HOURS = 1;
export const SCAN_CADENCE = SCAN_INTERVAL_HOURS === 1 ? "hour" : `${SCAN_INTERVAL_HOURS} hours`;
export const SCAN_MINUTE = 17;
export const QUOTE_REFRESH_MS = 30_000;
export const CANDLE_RETRY_MS = 30_000;
const CANDLE_MS: Record<Timeframe, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const CANDLE_GRACE_MS = 10_000;

/** Close time of the most recent finished candle (Binance closeTime = next open - 1ms). */
export function latestClosedCandleTime(timeframe: Timeframe, now: number): number {
  const duration = CANDLE_MS[timeframe];
  return Math.floor(now / duration) * duration - 1;
}

/**
 * Closed candles only change when an interval ends, so the chart refreshes just after
 * the next close instead of polling. While the exchange has not published the newest
 * closed candle yet it retries quickly, and backs off if the market looks halted.
 */
export function nextCandleRefreshMs(timeframe: Timeframe, lastCloseTime: number | null, now: number): number {
  const expected = latestClosedCandleTime(timeframe, now);
  if (lastCloseTime === null) return CANDLE_RETRY_MS * 2;
  if (lastCloseTime < expected) return now - expected < 300_000 ? CANDLE_RETRY_MS : 300_000;
  return Math.max(CANDLE_RETRY_MS, expected + 1 + CANDLE_MS[timeframe] - now + CANDLE_GRACE_MS);
}

/** CDN lifetime for a closed-candle response: until the next close, or briefly while the newest candle is missing. */
export function candleCacheSeconds(timeframe: Timeframe, lastCloseTime: number | null, now: number): number {
  const expected = latestClosedCandleTime(timeframe, now);
  if (lastCloseTime === null || lastCloseTime < expected) return 15;
  return Math.min(3600, Math.max(15, Math.ceil((expected + 1 + CANDLE_MS[timeframe] - now) / 1000) + 5));
}

/** Missing or aged quotes are never replaced with a research candle price. */
export function freshQuotePrice(quote: SpotQuote | undefined, symbol: string, now: number): number | null {
  if (!quote || quote.symbol !== symbol || !Number.isFinite(quote.price) || quote.price <= 0) return null;
  const age = now - Date.parse(quote.asOf);
  return Number.isFinite(age) && age >= -5_000 && age <= 120_000 ? quote.price : null;
}

/** Statistics must belong to the same fresh ticker; frozen scan values are not a fallback. */
export function freshQuoteStats(quote: SpotQuote | undefined, symbol: string, now: number): { change24h: number; quoteVolume24h: number } | null {
  const change24h = quote?.change24h, quoteVolume24h = quote?.quoteVolume24h;
  if (freshQuotePrice(quote, symbol, now) === null || typeof change24h !== "number" || typeof quoteVolume24h !== "number"
    || !Number.isFinite(change24h) || !Number.isFinite(quoteVolume24h) || change24h < -100 || quoteVolume24h < 0) return null;
  return { change24h, quoteVolume24h };
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
