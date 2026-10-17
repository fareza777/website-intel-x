import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/types";
import { backtestRotation, chooseRotation, rotationSignal } from "../lib/market/rotation";

const DAY = 86_400_000, end = Date.UTC(2026, 9, 1);
function daily(drift: number, days = 300, noise = .01, seed = 1): Candle[] {
  let state = seed, price = 100;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: days }, (_, i) => {
    const time = end - (days - i) * DAY; price *= Math.exp(drift + (random() - .5) * noise);
    return { time, closeTime: time + DAY - 1, open: price, high: price * 1.01, low: price * .99, close: price, volume: 1, quoteVolume: price, takerBuyVolume: .5 };
  });
}
const params = { lookbackDays: 28, holdings: 2, regimeSma: 100, rebalanceDays: 7 };

describe("momentum rotation", () => {
  it("holds the strongest risk-adjusted uptrends only while BTC is above its long average", () => {
    const universe = { BTCUSDT: daily(.002), AAAUSDT: daily(.006, 300, .01, 2), BBBUSDT: daily(.003, 300, .01, 3), CCCUSDT: daily(-.003, 300, .01, 4) };
    const signal = rotationSignal(universe, end, params);
    expect(signal.regimeOn).toBe(true);
    expect(signal.picks.map(pick => pick.symbol)).toContain("AAAUSDT");
    expect(signal.picks.map(pick => pick.symbol)).not.toContain("CCCUSDT");
    expect(signal.picks.reduce((s, pick) => s + pick.weight, 0)).toBeCloseTo(1);
    const bear = rotationSignal({ ...universe, BTCUSDT: daily(-.004) }, end, params);
    expect(bear.regimeOn).toBe(false);
    expect(bear.picks).toEqual([]);
  });
  it("ignores candles that close after the rebalance time", () => {
    const universe = { BTCUSDT: daily(.002), AAAUSDT: daily(.006, 300, .01, 2) };
    const before = rotationSignal(universe, end - 30 * DAY, params);
    const mutated = { BTCUSDT: universe.BTCUSDT.map(c => c.closeTime >= end - 30 * DAY ? { ...c, close: 1 } : c), AAAUSDT: universe.AAAUSDT };
    expect(rotationSignal(mutated, end - 30 * DAY, params)).toEqual(before);
  });
  it("backtests with turnover costs and chooses parameters from the grid", () => {
    const universe = { BTCUSDT: daily(.002), AAAUSDT: daily(.004, 300, .02, 2), BBBUSDT: daily(.001, 300, .02, 3), CCCUSDT: daily(.003, 300, .03, 5) };
    const result = backtestRotation(universe, end - 150 * DAY, end - DAY, params);
    expect(result.rebalances).toBeGreaterThan(0);
    expect(result.totalReturnPct).toBeGreaterThan(0);
    expect(result.equity.length).toBeGreaterThan(10);
    const costly = backtestRotation(universe, end - 150 * DAY, end - DAY, params, 500);
    expect(costly.totalReturnPct).toBeLessThan(result.totalReturnPct);
    expect(chooseRotation(universe, end - 150 * DAY, end - DAY).grid).toHaveLength(6);
  });
});
