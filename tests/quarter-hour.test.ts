import { describe, expect, it } from "vitest";
import type { Candle, MarketSetup, MarketSnapshot, Timeframe } from "../lib/types";
import { analyzeSymbol } from "../lib/market/setup";
import { advanceSignal, emptyState, hasCompleteSignalHistory, publishSignals } from "../lib/tracking";
import { makeTradePlan } from "../lib/market/risk";

const quarter = 900_000;
const now = Date.UTC(2026, 9, 16, 12, 17);
function series(duration: number, count = 300): Candle[] {
  const end = Math.floor(now / duration) * duration;
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * .1 + Math.sin(i * .8);
    const time = end - (count - i) * duration;
    return { time, closeTime: time + duration - 1, open: close - .2, high: close + .5, low: close - .5, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 550 };
  });
}
describe("15M research and executions", () => {
  it("calculates a separate 15M decision, causal context and six-hour expiry", () => {
    const candles = { "15m": series(quarter), "1h": series(4 * quarter), "4h": series(16 * quarter), "1d": series(96 * quarter) };
    const source = { symbol: "BTCUSDT", baseAsset: "BTC", change24h: 1, quoteVolume24h: 50_000_000, tickSize: .01, stepSize: .001, minNotional: 5, now, candles };
    const result = analyzeSymbol(source, "15m" as Timeframe);
    expect(result.timeframe).toBe("15m");
    expect(result.asOf).toBe(new Date(Date.UTC(2026, 9, 16, 12, 15) - 1).toISOString());
    expect(result.indicators).toHaveProperty("15m");
    expect(result.holdingPeriodHours).toBe(18);
    expect(Date.parse(result.expiresAt) - Date.parse(result.asOf)).toBe(6 * 3_600_000);
    const original = JSON.stringify(result);
    candles["15m"].push({ ...candles["15m"].at(-1)!, time: Math.floor(now / quarter) * quarter, closeTime: Math.floor(now / quarter) * quarter + quarter - 1, close: 10000, high: 20000 });
    expect(JSON.stringify(analyzeSymbol(source, "15m" as Timeframe))).toBe(original);
  });
  it("ignores the quarter underway at publication and evaluates the next full 15M candle", () => {
    const published = Date.UTC(2026, 9, 16, 12, 17);
    const setup = { id: "quarter-test", symbol: "BTCUSDT", baseAsset: "BTC", timeframe: "15m", action: "BUY", score: 95,
      expiresAt: new Date(published + 6 * 3_600_000).toISOString(), plan: makeTradePlan({ price: 100, atr: 1, tickSize: .01, stepSize: .01, minNotional: 5 }) } as MarketSetup;
    const state = publishSignals(emptyState(), { setups: [setup], generatedAt: new Date(published).toISOString() } as MarketSnapshot);
    const bar = (minute: number, low: number): Candle => ({ time: Date.UTC(2026, 9, 16, 12, minute), closeTime: Date.UTC(2026, 9, 16, 12, minute) + quarter - 1, open: 101, high: 102, low, close: 101, volume: 1000, quoteVolume: 101000, takerBuyVolume: 550 });
    const next = advanceSignal(state.signals[0], [bar(15, 90), bar(30, 99)], Date.UTC(2026, 9, 16, 12, 46));
    expect(next.status).toBe("OPEN");
    expect(next.enteredAt).toBe(new Date(Date.UTC(2026, 9, 16, 12, 30)).toISOString());
    expect(hasCompleteSignalHistory(next, Date.UTC(2026, 9, 16, 12, 46))).toBe(true);
    expect(hasCompleteSignalHistory(next, Date.UTC(2026, 9, 16, 13, 1))).toBe(false);
  });
});
