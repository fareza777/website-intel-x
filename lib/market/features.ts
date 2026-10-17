import type { Candle, IndicatorSet, MarketFeatures, MarketSetup, Timeframe } from "../types";
import { atr, ema } from "./indicators";
import { confirmedPivots } from "./structure";
import { DERIVATIVE_KEYS, type DerivativeFeatures } from "./derivative-keys";

const emptyDerivatives = (): DerivativeFeatures => Object.fromEntries(DERIVATIVE_KEYS.map(key => [key, null])) as DerivativeFeatures;

/** Wilder ADX; the first value needs 2×period bars. Returns null with less history. */
export function adx(candles: Candle[], period = 14): number | null {
  if (candles.length < period * 2 + 1) return null;
  let tr = 0, plus = 0, minus = 0, dxSum = 0, value: number | null = null;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.high - p.high, down = p.low - c.low;
    const range = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const pdm = up > down && up > 0 ? up : 0, mdm = down > up && down > 0 ? down : 0;
    if (i <= period) { tr += range; plus += pdm; minus += mdm; }
    else { tr = tr - tr / period + range; plus = plus - plus / period + pdm; minus = minus - minus / period + mdm; }
    if (i < period) continue;
    const pdi = tr > 0 ? plus / tr * 100 : 0, mdi = tr > 0 ? minus / tr * 100 : 0;
    const dx = pdi + mdi > 0 ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    if (i < period * 2) { dxSum += dx; continue; }
    value = value === null ? (dxSum + dx) / period : (value * (period - 1) + dx) / period;
  }
  return value;
}

/** Share of earlier values strictly below the latest value, from 0 to 1. */
export function percentileRank(values: number[], latest: number): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.filter(value => value < latest).length / finite.length : .5;
}

function logReturns(candles: Candle[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 1; i < candles.length; i++) map.set(candles[i].time, Math.log(candles[i].close / candles[i - 1].close));
  return map;
}

/** Relative strength and beta use time-aligned returns of the same decision interval. */
export function btcRelation(candles: Candle[], btc: Candle[] | undefined): { relativeStrength: number; beta: number } {
  if (!btc || btc.length < 25 || candles.length < 25) return { relativeStrength: 0, beta: 1 };
  const btcByTime = new Map(btc.map(candle => [candle.time, candle]));
  const latest = candles.at(-1)!, anchor = candles.at(-21)!;
  const btcLatest = btcByTime.get(latest.time), btcAnchor = btcByTime.get(anchor.time);
  const relativeStrength = btcLatest && btcAnchor ? Math.log(latest.close / anchor.close) - Math.log(btcLatest.close / btcAnchor.close) : 0;
  const own = logReturns(candles.slice(-61)), market = logReturns(btc);
  const pairs = [...own].flatMap(([time, value]) => market.has(time) ? [[value, market.get(time)!]] : []);
  if (pairs.length < 30) return { relativeStrength, beta: 1 };
  const meanA = pairs.reduce((s, [a]) => s + a, 0) / pairs.length, meanB = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
  const cov = pairs.reduce((s, [a, b]) => s + (a - meanA) * (b - meanB), 0), variance = pairs.reduce((s, [, b]) => s + (b - meanB) ** 2, 0);
  return { relativeStrength, beta: variance > 0 ? cov / variance : 1 };
}

/** Log-volume z-score. Hourly bars compare against the same UTC hour to remove session seasonality. */
export function volumeZ(candles: Candle[], timeframe: Timeframe): number {
  const latest = candles.at(-1)!;
  const prior = timeframe === "1h"
    ? candles.slice(0, -1).filter(candle => new Date(candle.time).getUTCHours() === new Date(latest.time).getUTCHours()).slice(-10)
    : candles.slice(timeframe === "15m" ? -49 : -21, -1);
  const logs = prior.map(candle => Math.log(candle.volume + 1));
  if (logs.length < 5) return 0;
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / logs.length);
  return sd > 0 ? Math.max(-5, Math.min(5, (Math.log(latest.volume + 1) - mean) / sd)) : 0;
}

/** Bollinger width (20, 2σ) relative to price for every bar with enough history. */
function bandWidths(candles: Candle[]): number[] {
  const closes = candles.map(candle => candle.close), widths: number[] = [];
  for (let i = 19; i < closes.length; i++) {
    const window = closes.slice(i - 19, i + 1), mean = window.reduce((s, v) => s + v, 0) / 20;
    widths.push(4 * Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / 20) / mean);
  }
  return widths;
}

export interface FeatureInput {
  timeframe: Timeframe; candles: Candle[]; indicators: IndicatorSet; score: number; entryModel: MarketSetup["entryModel"];
  buyPressure: number; aboveVwap: boolean; stopRiskPct: number | null; maximumStopRiskPct: number;
  btc?: Candle[]; btcTrend: "bullish" | "neutral" | "bearish" | "unavailable"; breadth: number | null;
  derivatives?: DerivativeFeatures;
}

/** Causal features from closed candles only. Every value is bounded so a bad bar cannot dominate the model. */
export function computeFeatures(input: FeatureInput): MarketFeatures {
  const { candles, indicators } = input;
  const latest = candles.at(-1)!, unit = indicators.atr > 0 ? indicators.atr : latest.close * .01;
  const clip = (value: number, limit: number) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
  const ema50 = ema(candles.map(candle => candle.close), 50);
  const slope = ema50.at(-1) != null && ema50.at(-11) != null ? (ema50.at(-1)! - ema50.at(-11)!) / unit : 0;
  const atrSeries = atr(candles).map((value, i) => value === null ? NaN : value / candles[i].close);
  const widths = bandWidths(candles);
  const priorHigh = Math.max(...candles.slice(-21, -1).map(candle => candle.high));
  const pivots = confirmedPivots(candles);
  const highs = pivots.filter(pivot => pivot.kind === "high").slice(-2), lows = pivots.filter(pivot => pivot.kind === "low").slice(-2);
  const swing = ((highs.length === 2 && highs[1].price > highs[0].price ? 1 : 0) + (lows.length === 2 && lows[1].price > lows[0].price ? 1 : 0)) / 2;
  const relation = btcRelation(candles, input.btc);
  return {
    score: input.score / 100,
    trendAtr: clip((latest.close - indicators.ema50) / unit, 15),
    slopeAtr: clip(slope, 10),
    rsi: indicators.rsi / 100,
    adx: (adx(candles) ?? 20) / 100,
    atrPercentile: percentileRank(atrSeries.slice(-201, -1), atrSeries.at(-1)!),
    squeeze: widths.length > 1 ? percentileRank(widths.slice(-201, -1), widths.at(-1)!) : .5,
    distanceHighAtr: clip((priorHigh - latest.close) / unit, 15),
    volumeZ: volumeZ(candles, input.timeframe),
    buyPressure: clip(input.buyPressure - .5, .5),
    relativeStrength: clip(relation.relativeStrength, 1),
    beta: clip(relation.beta, 5),
    btcTrend: input.btcTrend === "bullish" ? 1 : input.btcTrend === "bearish" ? -1 : 0,
    breadth: input.breadth ?? .5,
    breakout: input.entryModel === "BREAKOUT" ? 1 : 0,
    reclaim: input.entryModel === "STRUCTURE_RECLAIM" ? 1 : 0,
    pullback: input.entryModel === "PULLBACK" ? 1 : 0,
    stopRisk: input.stopRiskPct === null ? 1 : clip(input.stopRiskPct / input.maximumStopRiskPct, 3),
    swingStructure: swing,
    aboveVwap: input.aboveVwap ? 1 : 0,
    ...(input.derivatives ?? emptyDerivatives()),
    hasDerivatives: input.derivatives && Object.values(input.derivatives).some(value => value !== null) ? 1 : 0,
  };
}
