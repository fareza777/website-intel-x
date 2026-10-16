import type { Candle, MarketSetup, StructureEvent } from "../types";
import { ema } from "./indicators";

/** Closed decision-bar trigger; context scoring and account risk are separate. */
export function entrySignal(candles: Candle[], atr: number, relativeVolume: number, structure: StructureEvent[]): MarketSetup["entryModel"] {
  if (candles.length < 22 || !Number.isFinite(atr) || atr <= 0 || !Number.isFinite(relativeVolume)) return undefined;
  const latest = candles.at(-1)!, previous = candles.at(-2)!;
  if (latest.close <= latest.open) return undefined;
  const priorHigh = Math.max(...candles.slice(-21, -1).map(c => c.high));
  const confirmedStructure = structure.some(event => event.time === latest.closeTime && event.direction === "bullish" && ["BOS", "CHoCH", "SWEEP", "FALSE BREAKOUT"].includes(event.type));
  if (relativeVolume >= 1) {
    if (latest.close > priorHigh) return "BREAKOUT";
    if (confirmedStructure) return "STRUCTURE_RECLAIM";
  }
  const average = ema(candles.map(c => c.close), 21);
  const latestAverage = average.at(-1);
  if (latestAverage == null || latest.close <= latestAverage || latest.close <= previous.close) return undefined;
  const touch = candles.slice(-3).some((candle, i) => {
    const level = average[candles.length - 3 + i];
    return level != null && candle.low <= level + .25 * atr && candle.high >= level;
  });
  return touch ? "PULLBACK" : undefined;
}
