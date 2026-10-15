import type { Candle, IndicatorSet } from "../types";

type Series = (number | null)[];

function validate(values: number[], period: number): void {
  if (!Number.isInteger(period) || period < 1 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Indicators require finite values and a positive integer period");
  }
}

/** EMA starts at the first complete SMA. Earlier values remain unavailable. */
export function ema(values: number[], period: number): Series {
  validate(values, period);
  const result: Series = Array(values.length).fill(null);
  if (values.length < period) return result;
  let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = average;
  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    average += alpha * (values[index] - average);
    result[index] = average;
  }
  return result;
}

/** Wilder RSI seeds with `period` price changes, so its first value is at index period. */
export function rsi(values: number[], period = 14): Series {
  validate(values, period);
  const result: Series = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    gain += Math.max(0, change) / period;
    loss += Math.max(0, -change) / period;
  }
  const value = () => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  result[period] = value();
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
    result[index] = value();
  }
  return result;
}

/** First true range is high-low; subsequent ranges include gaps from previous close. */
export function atr(candles: Candle[], period = 14): Series {
  const ranges = candles.map((candle, index) => index === 0
    ? candle.high - candle.low
    : Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index - 1].close), Math.abs(candle.low - candles[index - 1].close)));
  validate(ranges, period);
  const result: Series = Array(candles.length).fill(null);
  if (candles.length < period) return result;
  let average = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = average;
  for (let index = period; index < ranges.length; index++) {
    average = (average * (period - 1) + ranges[index]) / period;
    result[index] = average;
  }
  return result;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): { line: Series; signal: Series; histogram: Series } {
  if (fast >= slow) throw new Error("MACD fast period must be below slow period");
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = values.map((_, index) => fastEma[index] !== null && slowEma[index] !== null ? fastEma[index]! - slowEma[index]! : null);
  const first = line.findIndex((value) => value !== null);
  const signal: Series = Array(values.length).fill(null);
  if (first >= 0) {
    const compactSignal = ema(line.slice(first) as number[], signalPeriod);
    for (let index = first; index < values.length; index++) signal[index] = compactSignal[index - first];
  }
  const histogram = line.map((value, index) => value !== null && signal[index] !== null ? value - signal[index]! : null);
  return { line, signal, histogram };
}

export function computeIndicators(candles: Candle[]): IndicatorSet {
  if (candles.length < 200) throw new Error("At least 200 closed candles are required for EMA200");
  const closes = candles.map((candle) => candle.close);
  const end = closes.length - 1;
  const ema21 = ema(closes, 21)[end]!;
  const ema50 = ema(closes, 50)[end]!;
  const ema200 = ema(closes, 200)[end]!;
  const momentum = macd(closes);
  const close = closes[end];
  const trend = close > ema21 && ema21 > ema50 && ema50 > ema200 ? "bullish"
    : close < ema21 && ema21 < ema50 && ema50 < ema200 ? "bearish" : "neutral";
  return { ema21, ema50, ema200, rsi: rsi(closes)[end]!, macd: momentum.line[end]!, macdSignal: momentum.signal[end]!, macdHistogram: momentum.histogram[end]!, atr: atr(candles)[end]!, trend };
}
