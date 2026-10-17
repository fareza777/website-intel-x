import type { Candle, MarketContextSummary, Timeframe } from "../types";
import { computeIndicators, ema } from "./indicators";
import type { CalibrationModel } from "./model";
import { REGIME } from "./policy";
import type { DerivativeDay } from "./derivatives";

/** Cross-market inputs shared by every symbol in one scan. All candles must be closed at scan time. */
export interface MarketContext {
  btc?: Partial<Record<Timeframe, Candle[]>>;
  /** Share of scanned markets closing above their EMA50 on each decision interval. */
  breadth?: Partial<Record<Timeframe, number>>;
  /** Futures archive days per symbol; features use only days published before the decision. */
  derivatives?: Record<string, DerivativeDay[]>;
  /** Defaults to the bundled frozen model; null disables model estimates. */
  model?: CalibrationModel | null;
}

/** Breadth uses the same SMA-seeded EMA50 window as the scanner's own indicators. */
export function aboveEma50(candles: Candle[]): boolean | null {
  if (candles.length < 50) return null;
  const value = ema(candles.map(candle => candle.close), 50).at(-1);
  return value == null ? null : candles.at(-1)!.close > value;
}

export function breadthOf(windows: Candle[][]): number | null {
  const states = windows.map(aboveEma50).filter((state): state is boolean => state !== null);
  return states.length >= 3 ? states.filter(Boolean).length / states.length : null;
}

/** The higher BTC interval that defines market tone for each decision horizon. */
export const BTC_REFERENCE: Record<Timeframe, Timeframe> = { "15m": "4h", "1h": "4h", "4h": "1d", "1d": "1d" };

export function summarizeContext(context: MarketContext | undefined, timeframe: Timeframe, cutoff: number): { summary: MarketContextSummary; btc?: Candle[] } {
  const frame = BTC_REFERENCE[timeframe];
  const reference = context?.btc?.[frame]?.filter(candle => candle.closeTime <= cutoff);
  let btcTrend: MarketContextSummary["btcTrend"] = "unavailable";
  if (reference && reference.length >= 200) btcTrend = computeIndicators(reference.slice(-259)).trend;
  const breadth = context?.breadth?.[timeframe] ?? null;
  const riskOff = btcTrend === "bearish" && breadth !== null && breadth < REGIME.riskOffBreadth;
  const detail = btcTrend === "unavailable" && breadth === null ? "Market context unavailable; regime gate not evaluated."
    : `BTC ${frame.toUpperCase()} trend ${btcTrend}; ${breadth === null ? "breadth unavailable" : `${Math.round(breadth * 100)}% of scanned markets above ${timeframe.toUpperCase()} EMA50`}. Risk-off requires a bearish BTC trend and breadth below ${REGIME.riskOffBreadth * 100}%.`;
  return { summary: { btcTrend, breadth, riskOff, detail }, btc: context?.btc?.[timeframe]?.filter(candle => candle.closeTime <= cutoff) };
}
