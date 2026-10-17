import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "../lib/types";
import { INTERVAL_MS } from "../lib/market/binance";
import { analyzeSymbol as analyzeWithModel } from "../lib/market/setup";
// These tests exercise the rule path; the bundled calibration model is tested separately.
const analyzeSymbol = (input: Parameters<typeof analyzeWithModel>[0], timeframe?: Parameters<typeof analyzeWithModel>[1], context: Parameters<typeof analyzeWithModel>[2] = { model: null }) => analyzeWithModel(input, timeframe, context);
import { makeTradePlan } from "../lib/market/risk";
import { historicalInput, markedEquity, replaySymbol } from "../lib/research/replay";
import { createPaperAccount } from "../lib/paper";
import { scannerReportSchema } from "../lib/research/validation";

const hour = 3_600_000, start = Date.UTC(2026, 9, 16, 12, 17), end = start + 3 * hour;
function source() {
  const candles = Object.fromEntries(Object.entries(INTERVAL_MS).map(([frame, duration]) => {
    const stop = Math.ceil(end / duration) * duration;
    return [frame, Array.from({ length: 350 }, (_, i) => {
      const time = stop - (350 - i) * duration, close = 100 + Math.sin(i * .7) * .5;
      return { time, closeTime: time + duration - 1, open: close - .1, high: close + 1, low: close - 1, close, volume: 100000, quoteVolume: close * 100000, takerBuyVolume: 55000 };
    })];
  })) as Record<Timeframe, Candle[]>;
  return { symbol: "BTCUSDT", baseAsset: "BTC", tickSize: .01, stepSize: .001, minNotional: 5, candles };
}
describe("exact scanner replay", () => {
  it("uses 259 closed bars and historical 24-hour quote volume, without future values", () => {
    const data = source(); const input = historicalInput(data, start);
    expect(input.candles["15m"]).toHaveLength(259);
    expect(input.candles["1h"]).toHaveLength(259);
    const last24 = data.candles["1h"].filter(c => c.closeTime < start).slice(-24);
    expect(input.quoteVolume24h).toBe(last24.reduce((sum, c) => sum + c.quoteVolume, 0));
    expect(input.change24h).toBeCloseTo((last24.at(-1)!.close / last24[0].open - 1) * 100);
    for (const candles of Object.values(data.candles)) for (const c of candles) if (c.closeTime >= start) Object.assign(c, { close: 90000, high: 99999, quoteVolume: 1e15 });
    expect(historicalInput(data, start)).toEqual(input);
  });
  it("keeps pending cash as equity instead of recording a fictitious loss", () => {
    const account = createPaperAccount(10000); account.cash = 7000;
    account.positions = [{ settled: false, reserved: 3000, signal: { enteredAt: null } }] as typeof account.positions;
    expect(markedEquity(account, 100)).toBe(10000);
  });
  it("reuses publication delay, entry-bar target exclusion, opening targets and costed portfolio accounting", () => {
    const data = source();
    const entry = data.candles["1h"].find(c => c.time === Date.UTC(2026, 9, 16, 13))!;
    Object.assign(entry, { open: 101, high: 150, low: 99, close: 101 });
    const exit = data.candles["1h"].find(c => c.time === Date.UTC(2026, 9, 16, 14))!;
    Object.assign(exit, { open: 110, high: 115, low: 95, close: 100 });
    const plan = makeTradePlan({ price: 100, atr: 1, tickSize: .01, stepSize: .001, minNotional: 5 })!;
    const result = replaySymbol(data, start, end, { analyzer: (input, tf) => {
      const original = analyzeSymbol(input, tf); const buy = tf === "1h" && input.now === start;
      return { ...original, id: `${tf}-${input.now}`, action: buy ? "BUY" : "NO TRADE", plan: buy ? plan : null };
    } });
    const row = result.find(r => r.timeframe === "1h")!;
    expect(row.publishedBuy).toBe(1); expect(row.completed).toBe(1); expect(row.filled).toBe(1);
    expect(row.trades[0].enteredAt).toBe(new Date(Date.UTC(2026, 9, 16, 13)).toISOString());
    expect(row.trades[0].exitAt).toBe(new Date(Date.UTC(2026, 9, 16, 14)).toISOString());
    expect(row.trades[0].exitFill).toBeCloseTo(plan.targets[2].price * .9995);
    expect(row.netReturnPct).toBeCloseTo(row.trades[0].pnl / 10000 * 100);
    expect(row.winRate).toBe(100); expect(row.profitFactor).toBeNull();
  });
  it("refunds expired BUY reservations and leaves account return zero without a filled trade", () => {
    const data = source();
    const plan = makeTradePlan({ price: 80, atr: 1, tickSize: .01, stepSize: .001, minNotional: 5 })!;
    const row = replaySymbol(data, start, end, { analyzer: (input, tf) => ({ ...analyzeSymbol(input, tf),
      id: `${tf}-${input.now}`, action: tf === "1h" && input.now === start ? "BUY" : "NO TRADE", plan: tf === "1h" && input.now === start ? plan : null,
      expiresAt: new Date(start + hour).toISOString(),
    }) }).find(row => row.timeframe === "1h")!;
    expect(row.publishedBuy).toBe(1); expect(row.expired).toBe(1); expect(row.filled).toBe(0);
    expect(row.netReturnPct).toBe(0); expect(row.maxDrawdownPct).toBe(0); expect(row.winRate).toBeNull();
    expect(row.equity.every(point => point.value === 10000)).toBe(true);
  });
  it("cannot change past replay results by appending future candles", () => {
    const data = source(), before = replaySymbol(data, start, end);
    for (const tf of Object.keys(INTERVAL_MS) as Timeframe[]) {
      const last = data.candles[tf].at(-1)!; const time = last.time + INTERVAL_MS[tf];
      data.candles[tf].push({ ...last, time, closeTime: time + INTERVAL_MS[tf] - 1, high: 99999, close: 99999, quoteVolume: 1e15 });
    }
    expect(replaySymbol(data, start, end)).toEqual(before);
    expect(() => replaySymbol(data, start, end, { riskPercent: 6 })).toThrow(/risk/i);
  });
  it("marks higher-horizon open positions using the closed execution feed, rather than a stale daily close", () => {
    const data = source(), stop = start + 2 * hour;
    Object.assign(data.candles["1h"].find(c => c.time === Date.UTC(2026, 9, 16, 13))!, { open: 101, high: 104, low: 99, close: 103 });
    const plan = makeTradePlan({ price: 100, atr: 1, tickSize: .01, stepSize: .001, minNotional: 5 })!;
    // Equal sizing isolates the marking rule from volatility-based size guidance.
    const rows = replaySymbol(data, start, stop, { analyzer: (input, tf) => ({ ...analyzeSymbol(input, tf), sizing: undefined, id: `${tf}-${input.now}`,
      action: tf !== "15m" && input.now === start ? "BUY" : "NO TRADE", plan: tf !== "15m" && input.now === start ? plan : null,
    }) });
    const hourly = rows.find(row => row.timeframe === "1h")!;
    expect(hourly.open).toBe(1); expect(hourly.netReturnPct).toBeGreaterThan(0);
    expect(rows.find(row => row.timeframe === "4h")!.netReturnPct).toBeCloseTo(hourly.netReturnPct, 10);
    expect(rows.find(row => row.timeframe === "1d")!.netReturnPct).toBeCloseTo(hourly.netReturnPct, 10);
  });
  it("validates evidence boundaries and rejects invented inconsistent trade counts", () => {
    const rows = replaySymbol(source(), start, end);
    const report = { version: 1, strategyVersion: "cx-spot-3", codeHash: "a".repeat(64), generatedAt: new Date(end).toISOString(), start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      symbols: ["BTCUSDT"], scanIntervalHours: 1, assumedPublicationMinute: 17, closedWindow: 259, capitalPerAccount: 10000, initialCapitalRiskPct: 1, feeBps: 10, slippageBps: 5, rows, failures: [], notes: [] };
    expect(scannerReportSchema.safeParse(report).success).toBe(true);
    expect(scannerReportSchema.safeParse({ ...report, rows: [{ ...rows[0], completed: 99 }] }).success).toBe(false);
    expect(scannerReportSchema.safeParse({ ...report, end: "2099-01-01T00:00:00.000Z" }).success).toBe(false);
  });
});
