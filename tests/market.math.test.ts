import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/types";
import { atr, ema, macd, rsi } from "../lib/market/indicators";
import { confirmedPivots, detectStructure } from "../lib/market/structure";
import { volumeIntelligence } from "../lib/market/volume";

const hour = 3_600_000;
function bar(index: number, open: number, high: number, low: number, close: number): Candle {
  return { time: index * hour, closeTime: (index + 1) * hour - 1, open, high, low, close, volume: 10, quoteVolume: close * 10, takerBuyVolume: 6 };
}

describe("indicator conventions", () => {
  it("seeds EMA with the first complete SMA and does not backfill warmup", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("matches Wilder's published 14-period RSI seed example", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46];
    const values = rsi(closes, 14);
    expect(values.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(values[14]).toBeCloseTo(70.464135, 5);
    expect(values[15]).toBeCloseTo(66.249619, 5);
    expect(rsi([7, 7, 7, 7], 3)[3]).toBe(50);
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
  });

  it("uses Wilder smoothing for ATR including gaps in true range", () => {
    const candles = [bar(0, 9, 10, 8, 9), bar(1, 10, 12, 9, 11), bar(2, 12, 15, 11, 14), bar(3, 15, 17, 14, 16)];
    expect(atr(candles, 3)).toEqual([null, null, 3, 3]);
    expect(atr([bar(0, 10, 11, 9, 10), bar(1, 15, 16, 14, 15)], 2)[1]).toBe(4);
  });

  it("computes MACD with independently seeded fast, slow and signal EMAs", () => {
    const result = macd([1, 2, 3, 4, 5, 6, 7], 3, 5, 2);
    expect(result.line).toEqual([null, null, null, null, 1, 1, 1]);
    expect(result.signal).toEqual([null, null, null, null, null, 1, 1]);
    expect(result.histogram[6]).toBe(0);
  });

  it("leaves every previous indicator result unchanged when future bars arrive", () => {
    const values = Array.from({ length: 90 }, (_, i) => 40 + i / 8 + Math.sin(i));
    expect(ema(values, 21).slice(0, 70)).toEqual(ema(values.slice(0, 70), 21));
    expect(rsi(values).slice(0, 70)).toEqual(rsi(values.slice(0, 70)));
    expect(macd(values).histogram.slice(0, 70)).toEqual(macd(values.slice(0, 70)).histogram);
  });
});

describe("causal market structure", () => {
  const candles = [bar(0, 9, 10, 8, 9), bar(1, 10, 12, 9, 11), bar(2, 11, 14, 10, 12), bar(3, 11, 12, 9, 10), bar(4, 10, 11, 8, 9), bar(5, 11, 16, 10, 15), bar(6, 14, 15, 9, 10)];
  it("publishes pivots only after their right-side confirmation has closed", () => {
    expect(confirmedPivots(candles.slice(0, 4)).find((p) => p.kind === "high")).toBeUndefined();
    const pivot = confirmedPivots(candles.slice(0, 5)).find((p) => p.kind === "high");
    expect(pivot).toMatchObject({ price: 14, pivotTime: candles[2].time, confirmedTime: candles[4].closeTime });
  });

  it("timestamps a break and its heuristic order block at the confirming bar", () => {
    const events = detectStructure(candles.slice(0, 6));
    expect(events).toContainEqual(expect.objectContaining({ type: "BOS", direction: "bullish", price: 14, time: candles[5].closeTime }));
    expect(events).toContainEqual(expect.objectContaining({ type: "ORDER BLOCK", direction: "bullish", time: candles[5].closeTime }));
  });

  it("never rewrites historical structure when later candles are appended", () => {
    for (let length = 3; length <= candles.length; length++) {
      const cutoff = candles[length - 1].closeTime;
      expect(detectStructure(candles).filter((event) => event.time <= cutoff)).toEqual(detectStructure(candles.slice(0, length)));
    }
  });

  it("creates a three-bar FVG only when the third closed bar leaves the gap", () => {
    const gap = [bar(0, 9, 10, 8, 9), bar(1, 9, 15, 9, 14), bar(2, 14, 16, 12, 15)];
    expect(detectStructure(gap.slice(0, 2)).some((e) => e.type === "FVG")).toBe(false);
    expect(detectStructure(gap)).toContainEqual(expect.objectContaining({ type: "FVG", direction: "bullish", price: 11, time: gap[2].closeTime }));
  });

  it("distinguishes a failed break from a later change of structure", () => {
    const reversal = [...candles, bar(7, 9, 10, 6, 7)];
    const events = detectStructure(reversal);
    expect(events).toContainEqual(expect.objectContaining({ type: "FALSE BREAKOUT", direction: "bearish", price: 14, time: reversal[6].closeTime }));
    expect(events).toContainEqual(expect.objectContaining({ type: "CHoCH", direction: "bearish", price: 8, time: reversal[7].closeTime }));
  });

  it("recognizes a wick sweep without inventing a closed-candle breakout", () => {
    const swept = [...candles.slice(0, 5), bar(5, 12, 15, 11, 13)];
    const events = detectStructure(swept);
    expect(events).toContainEqual(expect.objectContaining({ type: "SWEEP", direction: "bearish", price: 14 }));
    expect(events.some((event) => event.type === "BOS")).toBe(false);
  });
});

describe("volume intelligence", () => {
  it("derives VWAP from actual quote/base totals and pressure from taker buy base volume", () => {
    const candles = [{ ...bar(0, 11, 13, 10, 12), volume: 10, quoteVolume: 120, takerBuyVolume: 8 }, { ...bar(1, 17, 19, 16, 18), volume: 20, quoteVolume: 360, takerBuyVolume: 10 }];
    const result = volumeIntelligence(candles, 0);
    expect(result.vwap).toBe(16);
    expect(result.buyPressure).toBe(0.6);
    expect(result.profile.reduce((sum, bucket) => sum + bucket.volume, 0)).toBeCloseTo(30, 8);
  });
});
