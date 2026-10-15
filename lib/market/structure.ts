import type { Candle, StructureEvent } from "../types";

export interface ConfirmedPivot {
  kind: "high" | "low";
  price: number;
  pivotTime: number;
  confirmedTime: number;
  index: number;
  confirmedIndex: number;
}

/** Strict local extrema become knowable only after `right` closed candles. */
export function confirmedPivots(candles: Candle[], left = 2, right = 2): ConfirmedPivot[] {
  if (!Number.isInteger(left) || !Number.isInteger(right) || left < 1 || right < 1) throw new Error("Pivot windows must be positive integers");
  const pivots: ConfirmedPivot[] = [];
  for (let index = left; index + right < candles.length; index++) {
    const window = candles.slice(index - left, index + right + 1);
    const candidate = candles[index];
    for (const kind of ["high", "low"] as const) {
      const isPivot = window.every((other, offset) => offset === left || (kind === "high" ? candidate.high > other.high : candidate.low < other.low));
      if (isPivot) pivots.push({ kind, price: candidate[kind], pivotTime: candidate.time, confirmedTime: candles[index + right].closeTime, index, confirmedIndex: index + right });
    }
  }
  return pivots;
}

/** Event times are exchange Unix milliseconds at confirmation close, matching Candle.closeTime. */
export function detectStructure(candles: Candle[]): StructureEvent[] {
  const pivots = confirmedPivots(candles);
  const events: StructureEvent[] = [];
  let pivotCursor = 0;
  let swingHigh: ConfirmedPivot | undefined;
  let swingLow: ConfirmedPivot | undefined;
  let lastDirection: "bullish" | "bearish" | undefined;
  let brokenHighTime: number | undefined;
  let brokenLowTime: number | undefined;
  let recentBreak: { direction: "bullish" | "bearish"; price: number; index: number } | undefined;

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const previous = candles[index - 1];
    while (pivotCursor < pivots.length && pivots[pivotCursor].confirmedIndex <= index) {
      const pivot = pivots[pivotCursor++];
      if (pivot.kind === "high") swingHigh = pivot;
      else swingLow = pivot;
    }
    const add = (type: StructureEvent["type"], direction: StructureEvent["direction"], price: number, description: string) => {
      events.push({ type, direction, price, time: candle.closeTime, description });
    };
    if (previous && swingLow && candle.low < swingLow.price && candle.close > swingLow.price && previous.close >= swingLow.price) {
      add("SWEEP", "bullish", swingLow.price, "Wick crossed a previously confirmed swing low and closed back above it; candle-based liquidity sweep heuristic.");
    }
    if (previous && swingHigh && candle.high > swingHigh.price && candle.close < swingHigh.price && previous.close <= swingHigh.price) {
      add("SWEEP", "bearish", swingHigh.price, "Wick crossed a previously confirmed swing high and closed back below it; candle-based liquidity sweep heuristic.");
    }
    if (previous && recentBreak && index > recentBreak.index && index - recentBreak.index <= 3) {
      const failedBullish = recentBreak.direction === "bullish" && previous.close >= recentBreak.price && candle.close < recentBreak.price;
      const failedBearish = recentBreak.direction === "bearish" && previous.close <= recentBreak.price && candle.close > recentBreak.price;
      if (failedBullish || failedBearish) {
        add("FALSE BREAKOUT", failedBullish ? "bearish" : "bullish", recentBreak.price, "Closed back across a broken confirmed swing within three closed bars; failed-breakout heuristic.");
        recentBreak = undefined;
      }
    }
    const bullishBreak = previous && swingHigh && brokenHighTime !== swingHigh.pivotTime && previous.close <= swingHigh.price && candle.close > swingHigh.price;
    const bearishBreak = previous && swingLow && brokenLowTime !== swingLow.pivotTime && previous.close >= swingLow.price && candle.close < swingLow.price;
    if (bullishBreak || bearishBreak) {
      const direction = bullishBreak ? "bullish" : "bearish";
      const pivot = bullishBreak ? swingHigh! : swingLow!;
      const type = lastDirection && lastDirection !== direction ? "CHoCH" : "BOS";
      add(type, direction, pivot.price, `${type}: closed through a swing that was already confirmed by two right-side candles.`);
      if (direction === "bullish") brokenHighTime = pivot.pivotTime;
      else brokenLowTime = pivot.pivotTime;
      lastDirection = direction;
      recentBreak = { direction, price: pivot.price, index };
      for (let candidate = index - 1; candidate >= Math.max(0, index - 10); candidate--) {
        const block = candles[candidate];
        if (direction === "bullish" ? block.close < block.open : block.close > block.open) {
          add("ORDER BLOCK", direction, (block.open + block.close) / 2, "Heuristic order block: body midpoint of the last opposing candle within ten bars before this confirmed break. Known only at the break; not proof of institutional orders.");
          break;
        }
      }
    }
    if (index >= 2) {
      const first = candles[index - 2];
      const middle = candles[index - 1];
      const displacement = Math.abs(middle.close - middle.open) >= (middle.high - middle.low) * 0.5;
      if (displacement && middle.close > middle.open && candle.low > first.high) {
        add("FVG", "bullish", (first.high + candle.low) / 2, "Three closed candles leave a bullish high-to-low price gap around a displacement candle; FVG midpoint, not an exchange order-book imbalance.");
      }
      if (displacement && middle.close < middle.open && candle.high < first.low) {
        add("FVG", "bearish", (first.low + candle.high) / 2, "Three closed candles leave a bearish low-to-high price gap around a displacement candle; FVG midpoint, not an exchange order-book imbalance.");
      }
    }
  }
  return events;
}
