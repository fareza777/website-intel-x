import { describe, expect, it } from "vitest";
import { measurementPrice, measurePriceMove } from "../lib/chart-measurement";

describe("chart price ruler", () => {
  it("keeps small endpoint and delta labels distinguishable", () => {
    expect(measurementPrice(.000000100)).not.toBe(measurementPrice(.000000101));
    expect(measurementPrice(.000000001)).toBe("$1e-9");
    expect(measurementPrice(0)).toBe("$0");
    expect(measurementPrice(NaN)).toBe("—");
  });
  it("measures signed movement against the first raw price and counts candle intervals", () => {
    expect(measurePriceMove({ price: 100, time: 0 }, { price: 115, time: 7_200_000 }, 3_600_000)).toEqual({ priceChange: 15, percentChange: 15, bars: 2, durationMs: 7_200_000 });
    const reversed = measurePriceMove({ price: 115, time: 7_200_000 }, { price: 100, time: 0 }, 3_600_000);
    expect(reversed).toMatchObject({ priceChange: -15, bars: 2, durationMs: 7_200_000 });
    expect(reversed?.percentChange).toBeCloseTo(-13.04347826087, 10);
  });
  it("handles tiny prices and zero movement without using rounded display values", () => {
    expect(measurePriceMove({ price: .00000010, time: 0 }, { price: .00000011, time: 900_000 }, 900_000)?.percentChange).toBeCloseTo(10, 10);
    expect(measurePriceMove({ price: 10, time: 0 }, { price: 10, time: 0 }, 900_000)).toEqual({ priceChange: 0, percentChange: 0, bars: 0, durationMs: 0 });
  });
  it("rejects invalid points or intervals", () => {
    for (const price of [0, -1, NaN, Infinity]) expect(measurePriceMove({ price, time: 0 }, { price: 1, time: 1 }, 1)).toBeNull();
    expect(measurePriceMove({ price: 1, time: NaN }, { price: 1, time: 1 }, 1)).toBeNull();
    expect(measurePriceMove({ price: 1, time: 0 }, { price: 1, time: 1 }, 0)).toBeNull();
  });
});
