import { describe, expect, it } from "vitest";
import { advanceSignal, publishSignals, emptyState, hasCompleteSignalHistory } from "../lib/tracking";
import type { Candle, MarketSetup, MarketSnapshot, TrackedSignal } from "../lib/types";

function setup(): MarketSetup {
  const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: 0.5, macdHistogram: 0.5, atr: 2, trend: "bullish" as const };
  return { id: "BTCUSDT-1", symbol: "BTCUSDT", baseAsset: "BTC", name: "Bitcoin", price: 101, change24h: 2, quoteVolume24h: 1e9, score: 80, action: "BUY", regime: "BULLISH", asOf: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T01:00:00Z", plan: { entry: 100, entryZone: [99, 101], stopLoss: 95, targets: [{ price: 110, rr: 2, gainPct: 10 }, { price: 115, rr: 3, gainPct: 15 }, { price: 120, rr: 4, gainPct: 20 }], riskPct: 5, feeBps: 10, slippageBps: 5, tickSize: 0.01, stepSize: 0.001, minNotional: 5 }, indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1.5, buyPressure: 0.6, profile: [] }, sparkline: [] };
}
function snapshot(s: MarketSetup): MarketSnapshot {
  return { version: 1, generatedAt: "2026-01-01T01:01:00Z", dataAsOf: s.asOf, source: "test fixture", status: "live", universeSize: 1, scanned: 1, setups: [s], errors: [], durationMs: 1, costs: { feeBps: 10, slippageBps: 5 } };
}
function bar(hour: number, open: number, high: number, low: number, close: number): Candle {
  const time = Date.parse(`2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`);
  return { time, closeTime: time + 3599999, open, high, low, close, volume: 100, quoteVolume: 10000, takerBuyVolume: 50 };
}
function pending(): TrackedSignal { return publishSignals(emptyState(), snapshot(setup())).signals[0]; }

describe("published signal ledger", () => {
  it("deduplicates publication and preserves the original levels", () => {
    const s = setup();
    const first = publishSignals(emptyState(), snapshot(s));
    s.plan!.entry = 999;
    const again = publishSignals(first, snapshot(s));
    expect(again.signals).toHaveLength(1);
    expect(again.signals[0].setup.plan!.entry).toBe(100);
  });
  it("archives conditional WAIT research without simulating an unconfirmed entry", () => {
    const waiting = { ...setup(), action: "WAIT" as const };
    const state = publishSignals(emptyState(), snapshot(waiting));
    expect(state.signals).toHaveLength(1);
    const result = advanceSignal(state.signals[0], [bar(2, 102, 125, 99, 101)], Date.parse("2026-01-01T04:00:00Z"));
    expect(result.status).toBe("PENDING");
    expect(result.enteredAt).toBeNull();
  });
  it("preserves a WAIT original when a later qualified BUY supersedes it", () => {
    const waiting = { ...setup(), action: "WAIT" as const };
    const state = publishSignals(emptyState(), snapshot(waiting));
    const buy = { ...setup(), id: "BTCUSDT-2" };
    const result = publishSignals(state, snapshot(buy));
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].setup.action).toBe("WAIT");
    expect(result.signals[0].status).toBe("INVALIDATED");
    expect(result.signals[1].status).toBe("PENDING");
  });
  it("does not fill on a candle already underway at publication", () => {
    const result = advanceSignal(pending(), [bar(1, 101, 105, 99, 102)], Date.parse("2026-01-01T03:00:00Z"));
    expect(result.status).toBe("PENDING");
  });
  it("ignores same-bar targets after a new limit fill", () => {
    const result = advanceSignal(pending(), [bar(2, 102, 125, 99, 101)], Date.parse("2026-01-01T04:00:00Z"));
    expect(result.status).toBe("OPEN");
    expect(result.highestTarget).toBe(0);
  });
  it("uses the stop first when both target and stop trade in an open position", () => {
    const result = advanceSignal(pending(), [bar(2, 102, 105, 99, 101), bar(3, 100, 125, 94, 99)], Date.parse("2026-01-01T05:00:00Z"));
    expect(result.status).toBe("STOPPED");
    expect(result.realizedReturnPct).toBeCloseTo(-5.28457, 4);
  });
  it("fills a gap stop at the worse open and includes both fees and slippage", () => {
    const result = advanceSignal(pending(), [bar(2, 102, 105, 99, 101), bar(3, 90, 94, 88, 92)], Date.parse("2026-01-01T05:00:00Z"));
    expect(result.status).toBe("STOPPED");
    expect(result.exitFill).toBe(89.955);
    expect(result.realizedReturnPct).toBeLessThan(-10);
  });
  it("resolves a known opening TP3 before a later intrabar stop without crediting the favorable gap", () => {
    const result = advanceSignal(pending(), [bar(2, 102, 105, 99, 101), bar(3, 121, 125, 94, 99)], Date.parse("2026-01-01T05:00:00Z"));
    expect(result.status).toBe("TP3");
    expect(result.highestTarget).toBe(3);
    expect(result.exitFill).toBeCloseTo(119.94, 8);
    expect(result.exitAt).toBe("2026-01-01T03:00:00.000Z");
    expect(result.realizedReturnPct).toBeGreaterThan(19);
  });
  it("records targets already reached at the open before a later stop", () => {
    const result = advanceSignal(pending(), [bar(2, 102, 105, 99, 101), bar(3, 116, 118, 94, 99)], Date.parse("2026-01-01T05:00:00Z"));
    expect(result.status).toBe("STOPPED");
    expect(result.highestTarget).toBe(2);
    expect(result.events.find(e => e.type === "TP2")?.at).toBe("2026-01-01T03:00:00.000Z");
  });
  it("requires completed history before manual management but allows recovered gaps", () => {
    const missing = advanceSignal(pending(), [bar(3, 102, 105, 99, 101)], Date.parse("2026-01-01T04:00:00Z"));
    expect(hasCompleteSignalHistory(missing, Date.parse("2026-01-01T04:00:00Z"))).toBe(false);
    expect(hasCompleteSignalHistory(pending(), Date.parse("2026-01-01T02:30:00Z"))).toBe(true);
    expect(hasCompleteSignalHistory(pending(), Date.parse("2026-01-01T03:00:00Z"))).toBe(false);
    const recovered = advanceSignal(missing, [bar(2, 102, 105, 99, 101), bar(3, 102, 105, 99, 101)], Date.parse("2026-01-01T04:00:00Z"));
    expect(recovered.events.some(e => e.type === "DATA GAP")).toBe(true);
    expect(hasCompleteSignalHistory(recovered, Date.parse("2026-01-01T04:00:00Z"))).toBe(true);
  });
  it("expires untouched entries after the original expiry", () => {
    const bars = Array.from({ length: 23 }, (_, i) => {
      const candle = bar(2, 105, 108, 102, 106);
      return { ...candle, time: candle.time + i * 3_600_000, closeTime: candle.closeTime + i * 3_600_000 };
    });
    const result = advanceSignal(pending(), bars, Date.parse("2026-01-03T00:00:00Z"));
    expect(result.status).toBe("EXPIRED");
    expect(result.realizedReturnPct).toBeNull();
  });
  it("does not invent a missed entry when market history is unavailable", () => {
    expect(advanceSignal(pending(), [], Date.parse("2026-01-05T00:00:00Z")).status).toBe("PENDING");
  });
  it("does not rewrite or repeat events when the same bars are evaluated twice", () => {
    const bars = [bar(2, 102, 105, 99, 101), bar(3, 101, 111, 100, 110)];
    const first = advanceSignal(pending(), bars, Date.parse("2026-01-01T05:00:00Z"));
    const second = advanceSignal(first, bars, Date.parse("2026-01-01T05:00:00Z"));
    expect(second.events).toEqual(first.events);
    expect(second.highestTarget).toBe(1);
    expect(second.realizedReturnPct).toBeNull();
  });
  it("exits at the 72nd completed hour rather than allowing a 73rd-hour stop", () => {
    const first = advanceSignal(pending(), [bar(2, 102, 105, 99, 101)], Date.parse("2026-01-01T04:00:00Z"));
    const nextBars = Array.from({ length: 71 }, (_, i) => {
      const candle = bar(3, 101, 105, 99, 102);
      return { ...candle, time: candle.time + i * 3_600_000, closeTime: candle.closeTime + i * 3_600_000 };
    });
    const result = advanceSignal(first, nextBars, Date.parse("2026-01-05T00:00:00Z"));
    expect(result.status).toBe("CLOSED");
    expect(result.exitAt).toBe("2026-01-04T01:59:59.999Z");
  });
  it("retains a 4H plan past the 1H strategy time limit", () => {
    const original = pending(); original.setup.timeframe = "4h"; original.setup.holdingPeriodHours = 216;
    const bars = Array.from({ length: 73 }, (_, i) => {
      const candle = bar(2, 102, 105, 99, 101);
      return { ...candle, time: candle.time + i * 3_600_000, closeTime: candle.closeTime + i * 3_600_000 };
    });
    const result = advanceSignal(original, bars, Date.parse("2026-01-05T12:00:00Z"));
    expect(result.status).toBe("OPEN");
    expect(result.setup.holdingPeriodHours).toBe(216);
  });
});
