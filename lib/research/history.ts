import type { Candle, Timeframe } from "../types";
import { getCandles, INTERVAL_MS, validateCandles } from "../market/binance";

/** Sequential, paginated closed-candle download that fails closed on any coverage gap. */
export async function history(symbol: string, frame: Timeframe, start: number, end: number, maxPages = 64): Promise<Candle[]> {
  const duration = INTERVAL_MS[frame]; let cursor = Math.floor(start / duration) * duration;
  const result: Candle[] = [];
  for (let page = 0; page < maxPages && cursor < end; page++) {
    const candles = (await getCandles(symbol, frame, 1000, cursor)).filter(c => c.closeTime < end);
    if (!candles.length) break;
    result.push(...candles); const next = candles.at(-1)!.time + duration;
    if (next <= cursor) throw new Error("Historical pagination did not advance"); cursor = next;
  }
  validateCandles(result, frame);
  if (!result.length || result[0].time > Math.floor(start / duration) * duration || end - result.at(-1)!.closeTime > duration) throw new Error(`Incomplete ${frame} historical coverage`);
  return result;
}
