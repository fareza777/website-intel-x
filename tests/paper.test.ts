import { expect, it } from "vitest";
import { applyPaperUpdates, createPaperAccount, importPaperAccount, reservePosition, reconcilePosition, settlePaperPosition } from "../lib/paper";
import { advanceSignal } from "../lib/tracking";
import type { MarketSetup, TrackedSignal } from "../lib/types";
const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: .5, macdHistogram: .5, atr: 2, trend: "bullish" as const };
const setup: MarketSetup = { id: "test", symbol: "BTCUSDT", baseAsset: "BTC", name: "Bitcoin", price: 100, change24h: 2, quoteVolume24h: 1e9, score: 90, action: "BUY", regime: "BULLISH", asOf: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1, buyPressure: .6, profile: [] }, sparkline: [], plan: { entry: 100, entryZone: [99, 101], stopLoss: 95, targets: [{ price: 110, rr: 2, gainPct: 10 }, { price: 115, rr: 3, gainPct: 15 }, { price: 120, rr: 4, gainPct: 20 }], feeBps: 10, slippageBps: 5, riskPct: 5, tickSize: .01, stepSize: .001, minNotional: 5 } };
it("reserves cash and prevents duplicate simulated positions", () => {
  const first = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  expect(first.cash).toBeGreaterThan(0);
  expect(first.cash + first.positions[0].reserved).toBeCloseTo(1000, 8);
  expect(() => reservePosition(first, setup, 1, "2026-01-01T00:00:00Z")).toThrow(/already/i);
});
it("refunds an expired unfilled order exactly once", () => {
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const expired = { ...account.positions[0].signal, status: "EXPIRED" } as TrackedSignal;
  const next = reconcilePosition(account, 0, expired);
  expect(next.cash).toBe(1000);
  expect(reconcilePosition(next, 0, expired).cash).toBe(1000);
});
it("settles a losing fill with both-side fees without creating cash", () => {
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const closed = { ...account.positions[0].signal, status: "STOPPED", enteredAt: "2026-01-01T01:00:00Z", entryFill: 100.05, exitAt: "2026-01-01T02:00:00Z", exitFill: 94.9525 } as TrackedSignal;
  const next = reconcilePosition(account, 0, closed);
  const quantity = account.positions[0].quantity;
  expect(next.cash).toBeCloseTo(1000 - quantity * (100.05 * 1.001 - 94.9525 * .999), 8);
});
it("rejects malformed portfolio imports and invalid starting capital", () => {
  expect(() => createPaperAccount(-1)).toThrow();
  expect(() => importPaperAccount('{"version":1,"cash":1e300,"positions":[]}')).toThrow();
  expect(() => importPaperAccount('{"version":1,"cash":500,"initialCapital":1000,"positions":[{}]}')).toThrow();
});
it("rejects incomplete plans, invalid lifecycle records, and nonfinite reservations", () => {
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const missingTargets = structuredClone(account);
  delete (missingTargets.positions[0].signal.setup.plan as unknown as Record<string, unknown>).targets;
  expect(() => importPaperAccount(JSON.stringify(missingTargets))).toThrow();
  const malformed = structuredClone(setup); malformed.plan!.stepSize = 0;
  expect(() => reservePosition(createPaperAccount(1000), malformed, 1, "2026-01-01T00:00:00Z")).toThrow();
  const badStatus = structuredClone(account); badStatus.positions[0].signal.status = "OPEN";
  expect(() => importPaperAccount(JSON.stringify(badStatus))).toThrow();
  const badCash = structuredClone(account); badCash.cash = 1000;
  expect(() => importPaperAccount(JSON.stringify(badCash))).toThrow();
  const impossibleTarget = structuredClone(account); impossibleTarget.positions[0].signal.highestTarget = 3;
  expect(() => importPaperAccount(JSON.stringify(impossibleTarget))).toThrow();
});
it("round-trips one-letter assets without corrupting local portfolios", () => {
  const single = { ...setup, symbol: "FUSDT", baseAsset: "F" };
  const account = reservePosition(createPaperAccount(1000), single, 1, "2026-01-01T00:00:00Z");
  expect(importPaperAccount(JSON.stringify(account)).positions[0].signal.setup.symbol).toBe("FUSDT");
});
it("preserves independent 4H research when the virtual account reloads", () => {
  const horizon = { ...setup, timeframe: "4h" as const, holdingPeriodHours: 216 };
  const account = reservePosition(createPaperAccount(1000), horizon, 1, "2026-01-01T00:00:00Z");
  expect(importPaperAccount(JSON.stringify(account)).positions[0].signal.setup.timeframe).toBe("4h");
});
it("preserves journal edits and newly reserved positions while reconciliation is in flight", () => {
  const original = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const changed = reservePosition(original, { ...setup, id: "second", symbol: "ETHUSDT", baseAsset: "ETH" }, 1, "2026-01-01T00:00:00Z");
  changed.positions[1].journal = "Keep this note typed while data loads";
  const expired = { ...original.positions[0].signal, status: "EXPIRED" } as TrackedSignal;
  const result = applyPaperUpdates(changed, [expired]);
  expect(result.positions).toHaveLength(2);
  expect(result.positions[1].journal).toBe("Keep this note typed while data loads");
  expect(result.positions[0].settled).toBe(false);
  expect(result.cash + result.positions[0].reserved).toBeCloseTo(1000, 8);
});
it("allows independent horizons while blocking duplicate research in the same horizon", () => {
  const first = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const four = { ...setup, id: "test-4h", timeframe: "4h" as const, holdingPeriodHours: 216 };
  expect(reservePosition(first, four, 1, "2026-01-01T00:00:00Z").positions).toHaveLength(2);
});
it("returns pending virtual cash on a manual cancellation without inventing a trade", () => {
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const cancelled = settlePaperPosition(account, setup.id, "2026-01-01T00:00:00Z", { kind: "cancel" }, "2026-01-01T00:30:00Z");
  expect(cancelled.cash).toBe(1000);
  expect(cancelled.positions[0].signal.enteredAt).toBeNull();
  expect(importPaperAccount(JSON.stringify(cancelled)).cash).toBe(1000);
});
it("closes a virtual position at a fresh quote with exact exit fees and slippage", () => {
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  const opened = { ...account.positions[0].signal, status: "OPEN", enteredAt: "2026-01-01T01:00:00Z", entryFill: 100.05, lastEvaluatedTime: Date.parse("2026-01-01T01:00:00Z") } as TrackedSignal;
  const active = reconcilePosition(account, 0, opened);
  const closed = settlePaperPosition(active, setup.id, "2026-01-01T00:00:00Z", { kind: "close", quote: { symbol: "BTCUSDT", price: 110, asOf: "2026-01-01T02:00:00Z" } }, "2026-01-01T02:00:30Z");
  expect(closed.positions[0].signal.exitFill).toBeCloseTo(109.945, 8);
  expect(closed.cash).toBeCloseTo(1000 + active.positions[0].quantity * (109.945 * .999 - 100.05 * 1.001), 8);
  expect(importPaperAccount(JSON.stringify(closed)).positions[0].settled).toBe(true);
  expect(() => settlePaperPosition(active, setup.id, "2026-01-01T00:00:00Z", { kind: "close", quote: { symbol: "BTCUSDT", price: 110, asOf: "2026-01-01T01:00:00Z" } }, "2026-01-01T02:00:30Z")).toThrow(/fresh/i);
});
it("blocks manual refunds until missing completed history is recovered", () => {
  const at = "2026-01-01T02:30:00Z";
  const account = reservePosition(createPaperAccount(1000), setup, 1, "2026-01-01T00:00:00Z");
  expect(() => settlePaperPosition(account, setup.id, "2026-01-01T00:00:00Z", { kind: "cancel" }, at)).toThrow(/history/i);
  const bars = [0, 1].map(hour => {
    const time = Date.parse("2026-01-01T00:00:00Z") + hour * 3_600_000;
    return { time, closeTime: time + 3_599_999, open: 105, high: 108, low: 102, close: 106, volume: 100, quoteVolume: 10600, takerBuyVolume: 50 };
  });
  const caughtUp = reconcilePosition(account, 0, advanceSignal(account.positions[0].signal, bars, Date.parse(at)));
  const cancelled = settlePaperPosition(caughtUp, setup.id, "2026-01-01T00:00:00Z", { kind: "cancel" }, at);
  expect(cancelled.cash).toBe(1000);
  expect(account.positions[0].settled).toBe(false);
});
