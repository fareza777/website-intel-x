import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { advanceSignal, emptyState, publishSignals } from "../lib/tracking";
import type { Candle, MarketSetup, MarketSnapshot, SignalEvent } from "../lib/types";
import { archiveState, candleStartTime, deliverWebhook, parseScanSymbols, retainSignals, runPublisher } from "../scripts/scan";

const directories: string[] = [];
const now = Date.parse("2026-10-15T12:17:00Z");
function snapshot(): MarketSnapshot {
  const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: 0.5, macdHistogram: 0.5, atr: 2, trend: "bullish" as const };
  const setup: MarketSetup = { id: "BTCUSDT-test", symbol: "BTCUSDT", baseAsset: "BTC", name: "Bitcoin", price: 101, change24h: 2, quoteVolume24h: 1e9, score: 85, action: "BUY", regime: "BULLISH", asOf: "2026-10-15T11:59:59.999Z", expiresAt: "2026-10-16T11:59:59.999Z", plan: { entry: 100, entryZone: [99, 101], stopLoss: 95, targets: [{ price: 110, rr: 2, gainPct: 10 }, { price: 115, rr: 3, gainPct: 15 }, { price: 120, rr: 4, gainPct: 20 }], riskPct: 5, feeBps: 10, slippageBps: 5, tickSize: 0.01, stepSize: 0.001, minNotional: 5 }, indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1.5, buyPressure: 0.6, profile: [] }, sparkline: [] };
  return { version: 1, generatedAt: new Date(now).toISOString(), dataAsOf: setup.asOf, source: "test fixture", status: "live", universeSize: 1, scanned: 1, setups: [setup], errors: [], durationMs: 1, costs: { feeBps: 10, slippageBps: 5 } };
}
async function directory() { const value = await mkdtemp(path.join(os.tmpdir(), "crypto-publisher-test-")); directories.push(value); return value; }
afterEach(async () => { for (const value of directories.splice(0)) { if (path.dirname(value) !== path.resolve(os.tmpdir())) throw new Error("Unsafe fixture cleanup"); await rm(value, { recursive: true, force: true }); } });

describe("scheduled publisher", () => {
  it("validates watchlist environment input and keeps valid one-letter bases", () => {
    expect(parseScanSymbols(" btcusdt, FUSDT btcusdt ")).toEqual(["BTCUSDT", "FUSDT"]);
    expect(parseScanSymbols("")).toBeUndefined();
    expect(() => parseScanSymbols("BTCUSDT; echo secret")).toThrow();
    expect(() => parseScanSymbols(Array.from({ length: 51 }, (_, i) => `A${i}USDT`).join(","))).toThrow();
  });
  it("evaluates from the next full candle after publication or the previous evaluated open", () => {
    const signal = publishSignals(emptyState(), snapshot()).signals[0];
    expect(candleStartTime(signal)).toBe(Date.parse("2026-10-15T13:00:00Z"));
    signal.lastEvaluatedTime = Date.parse("2026-10-15T14:00:00Z");
    expect(candleStartTime(signal)).toBe(Date.parse("2026-10-15T15:00:00Z"));
  });
  it("archives each immutable original and each final outcome once, including WAIT originals", async () => {
    const dir = await directory();
    const market = snapshot(); market.setups.push({ ...market.setups[0], id: "ETHUSDT-wait", symbol: "ETHUSDT", action: "WAIT" });
    const state = publishSignals(emptyState(), market);
    await archiveState(dir, state); await archiveState(dir, state);
    const original = await readFile(path.join(dir, "archives/originals/2026-10.jsonl"), "utf8");
    expect(original.trim().split("\n")).toHaveLength(2);
    state.signals[0].status = "STOPPED"; state.signals[0].exitAt = "2026-10-15T15:00:00Z"; state.signals[0].realizedReturnPct = -5.3;
    await archiveState(dir, state); await archiveState(dir, state);
    const outcomes = await readFile(path.join(dir, "archives/outcomes/2026-10.jsonl"), "utf8");
    expect(outcomes.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(outcomes).realizedReturnPct).toBe(-5.3);
    expect(await readFile(path.join(dir, "archives/originals/2026-10.jsonl"), "utf8")).toBe(original);
  });
  it("retains every active signal while compacting only completed state records", () => {
    const signal = publishSignals(emptyState(), snapshot()).signals[0];
    const signals = Array.from({ length: 1005 }, (_, index) => ({ ...structuredClone(signal), setup: { ...signal.setup, id: String(index) }, status: "CLOSED" as const, exitAt: new Date(now + index).toISOString() }));
    const retained = retainSignals([signal, ...signals]);
    expect(retained).toHaveLength(1001);
    expect(retained.some((value) => value.setup.id === signal.setup.id && value.status === "PENDING")).toBe(true);
    expect(retained.some((value) => value.setup.id === "0")).toBe(false);
    expect(retained.some((value) => value.setup.id === "1004")).toBe(true);
  });
  it("persists a diagnostic unavailable state while preserving the last valid prices", async () => {
    const dir = await directory(); const prior = publishSignals(emptyState(), snapshot());
    const failed = { ...snapshot(), status: "unavailable" as const, scanned: 0, setups: [], dataAsOf: null, errors: [{ symbol: "MARKET", message: "Provider unavailable" }] };
    const result = await runPublisher({ directory: dir, previous: prior, now, scan: async () => failed });
    expect(result.exitCode).toBe(1);
    const stored = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    expect(stored.snapshot.status).toBe("unavailable");
    expect(stored.snapshot.setups[0].price).toBe(101);
    expect(stored.snapshot.dataAsOf).toBe(prior.snapshot!.dataAsOf);
    expect(stored.signals[0].setup.plan.entry).toBe(100);
  });
  it("advances existing originals before publication without changing their frozen levels", async () => {
    const dir = await directory(); const prior = publishSignals(emptyState(), snapshot());
    const requested: number[] = [];
    const time = Date.parse("2026-10-15T13:00:00Z");
    const candle: Candle = { time, closeTime: time + 3_599_999, open: 102, high: 103, low: 99, close: 101, volume: 10, quoteVolume: 1010, takerBuyVolume: 6 };
    const market = snapshot(); market.setups[0].plan!.entry = 999;
    const result = await runPublisher({ directory: dir, previous: prior, now: time + 7_200_000, scan: async () => market, candles: async (_symbol, _interval, _limit, start) => { requested.push(start!); return [candle]; } });
    expect(requested).toEqual([time]);
    expect(result.state.signals[0].status).toBe("OPEN");
    expect(result.state.signals[0].setup.plan!.entry).toBe(100);
    expect(prior.signals[0].status).toBe("PENDING");
  });
  it("uses completion publication time when a scan crosses an hourly boundary", async () => {
    const dir = await directory();
    const market = snapshot(); market.generatedAt = "2026-10-15T09:59:55Z";
    const result = await runPublisher({ directory: dir, now: Date.parse("2026-10-15T10:00:20Z"), scan: async () => market });
    expect(result.state.snapshot!.generatedAt).toBe("2026-10-15T09:59:55Z");
    expect(result.state.signals[0].publishedAt).toBe("2026-10-15T10:00:20.000Z");
    expect(candleStartTime(result.state.signals[0])).toBe(Date.parse("2026-10-15T11:00:00Z"));
  });
  it.each(["BUY", "WAIT"] as const)("preserves %s invalidation in the final eligible entry hour", (action) => {
    const market = snapshot(); market.setups[0].action = action; market.setups[0].expiresAt = "2026-10-15T13:59:59.999Z";
    const signal = publishSignals(emptyState(), market).signals[0];
    const time = Date.parse("2026-10-15T13:00:00Z");
    const candle: Candle = { time, closeTime: time + 3_599_999, open: 94, high: 96, low: 90, close: 94, volume: 10, quoteVolume: 940, takerBuyVolume: 6 };
    const result = advanceSignal(signal, [candle], time + 2 * 3_600_000);
    expect(result.status).toBe("INVALIDATED");
    expect(result.events.some((event) => event.type === "EXPIRED")).toBe(false);
  });
  it("publishes and archives separate horizon originals without changing the legacy hourly snapshot", async () => {
    const dir = await directory(); const market = snapshot();
    const hourly = { ...market.setups[0], timeframe: "1h" as const, holdingPeriodHours: 72 };
    const four = { ...hourly, id: "BTCUSDT-test-4h", timeframe: "4h" as const, holdingPeriodHours: 216 };
    const daily = { ...hourly, id: "BTCUSDT-test-1d", timeframe: "1d" as const, holdingPeriodHours: 720 };
    market.setups = [hourly]; market.timeframes = { "1h": [hourly], "4h": [four], "1d": [daily] };
    const result = await runPublisher({ directory: dir, now, scan: async () => market });
    expect(result.state.signals.map((signal) => signal.setup.timeframe)).toEqual(["1h", "4h", "1d"]);
    expect(result.state.snapshot!.setups).toHaveLength(1);
    expect((await readFile(path.join(dir, "archives/originals/2026-10.jsonl"), "utf8")).trim().split("\n")).toHaveLength(3);
  });
  it("supersedes a WAIT only in the same asset and timeframe", () => {
    const market = snapshot(); const hourly = { ...market.setups[0], id: "hour-wait", action: "WAIT" as const };
    const four = { ...hourly, id: "four-wait", timeframe: "4h" as const };
    market.setups = [hourly, four];
    const prior = publishSignals(emptyState(), market);
    market.setups = [{ ...hourly, id: "hour-buy", action: "BUY" }];
    const result = publishSignals(prior, market);
    expect(result.signals.find((signal) => signal.setup.id === "hour-wait")!.status).toBe("INVALIDATED");
    expect(result.signals.find((signal) => signal.setup.id === "four-wait")!.status).toBe("PENDING");
    expect(result.signals.find((signal) => signal.setup.id === "hour-buy")!.status).toBe("PENDING");
  });
  it("preserves valid scanner evidence when a later report file is corrupt", async () => {
    const dir = await directory(), market = snapshot();
    const report = { version: 1, strategyVersion: "cx-spot-3", codeHash: "a".repeat(64), generatedAt: new Date(now).toISOString(), start: new Date(now - 3_600_000).toISOString(), end: new Date(now).toISOString(),
      symbols: ["BTCUSDT"], scanIntervalHours: 1, assumedPublicationMinute: 17, closedWindow: 259, capitalPerAccount: 10000, initialCapitalRiskPct: 1, feeBps: 10, slippageBps: 5, rows: [], failures: [], notes: [] };
    await writeFile(path.join(dir, "scanner-validation.json"), JSON.stringify(report));
    const first = await runPublisher({ directory: dir, now, scan: async () => market });
    expect(first.state.scannerValidation).toEqual(report);
    await writeFile(path.join(dir, "scanner-validation.json"), '{"version":1,"rows":[{"winRate":100}]}');
    const retry = await runPublisher({ directory: dir, now, previous: first.state, scan: async () => market, candles: async () => [] });
    expect(retry.state.scannerValidation).toEqual(report);
  });
  it("publishes 15M originals and reconciles only closed quarter-hour execution bars", async () => {
    const dir = await directory(), market = snapshot();
    const quarter = { ...market.setups[0], id: "BTCUSDT-test-15m", timeframe: "15m" as const, holdingPeriodHours: 18 };
    market.timeframes = { "15m": [quarter], "1h": [], "4h": [], "1d": [] };
    const first = await runPublisher({ directory: dir, now, scan: async () => market });
    expect(candleStartTime(first.state.signals[0])).toBe(Date.parse("2026-10-15T12:30:00Z"));
    const time = Date.parse("2026-10-15T12:30:00Z"), intervals: string[] = [];
    const second = await runPublisher({ directory: dir, now: time + 900_000, previous: first.state, scan: async () => market, candles: async (_symbol, interval) => {
      intervals.push(interval); return [{ time, closeTime: time + 899_999, open: 102, high: 103, low: 99, close: 101, volume: 10, quoteVolume: 1010, takerBuyVolume: 6 }];
    } });
    expect(intervals).toEqual(["15m"]);
    expect(second.state.signals[0].status).toBe("OPEN");
    expect(second.state.signals[0].setup.timeframe).toBe("15m");
    expect(second.state.signals[0].lastEvaluatedTime).toBe(time);
  });
  it("records successful webhook event ids and retains failures for later retry", async () => {
    const event: SignalEvent = { id: "s:ENTRY", signalId: "s", type: "ENTRY", at: new Date(now).toISOString(), price: 100, detail: "Fixture" };
    let deliveries = 0;
    const fetcher: typeof fetch = async () => { deliveries++; return new Response("", { status: 200 }); };
    const first = await deliverWebhook("https://example.test/alerts", { delivered: [], pending: [] }, [event], fetcher);
    const repeated = await deliverWebhook("https://example.test/alerts", first, [event], fetcher);
    expect(deliveries).toBe(1); expect(repeated.delivered).toEqual([event.id]);
    const failed = await deliverWebhook("https://example.test/alerts", { delivered: [], pending: [] }, [event], async () => new Response("", { status: 500 }));
    expect(failed.delivered).toEqual([]); expect(failed.pending).toEqual([event]);
  });
});
