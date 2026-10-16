import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/types";
import { entrySignal } from "../lib/market/entry";
function candles(): Candle[] {
  return Array.from({ length: 220 }, (_, i) => {
    const close = 100 + i * .1, time = i * 3600000;
    return { time, closeTime: time + 3599999, open: close - .04, high: close + .05, low: close - .05, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 500 };
  });
}
describe("closed price entry triggers", () => {
  it("compares a breakout with prior highs, excluding the current high", () => {
    const input = candles(), last = input.at(-1)!; last.high = last.close + 50;
    expect(entrySignal(input, .2, 1.1, [])).toBe("BREAKOUT");
    expect(entrySignal(input, .2, .9, [])).toBeUndefined();
  });
  it("requires a bullish recovery from EMA21 for a lower-volume pullback", () => {
    const input = candles(), last = input.at(-1)!;
    last.low = last.close - 1.4;
    expect(entrySignal(input, 1, .6, [])).toBe("PULLBACK");
    last.open = last.close + .1; last.high = last.open + .1;
    expect(entrySignal(input, 1, .6, [])).toBeUndefined();
  });
  it("does not recycle an older structure event into a new entry", () => {
    const input = candles(), last = input.at(-1)!;
    input[input.length - 8].high = last.close + 10;
    const event = { type: "BOS" as const, direction: "bullish" as const, price: last.close - .1, time: input.at(-3)!.closeTime, description: "Confirmed earlier" };
    expect(entrySignal(input, .2, 1.2, [event])).toBeUndefined();
    expect(entrySignal(input, .2, 1.2, [{ ...event, time: last.closeTime }])).toBe("STRUCTURE_RECLAIM");
  });
});
