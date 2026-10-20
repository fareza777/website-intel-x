import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { candleCacheSeconds, CANDLE_RETRY_MS, freshQuotePrice, latestClosedCandleTime, nextCandleRefreshMs, nextScheduledScan, quoteSubscription, SCAN_INTERVAL_HOURS } from "../lib/live-market";
import { compactJson } from "../lib/payload";

const now = Date.parse("2026-10-15T14:07:00Z");

describe("live prices are separate from frozen research", () => {
  it("uses a recent quote for the requested asset", () => {
    expect(freshQuotePrice({ symbol: "BTCUSDT", price: 80626.57, asOf: new Date(now - 30_000).toISOString() }, "BTCUSDT", now)).toBe(80626.57);
  });
  it("withholds old, future, invalid and mismatched quotes", () => {
    for (const quote of [
      { symbol: "BTCUSDT", price: 1, asOf: new Date(now - 120_001).toISOString() },
      { symbol: "BTCUSDT", price: 1, asOf: new Date(now + 5_001).toISOString() },
      { symbol: "ETHUSDT", price: 1, asOf: new Date(now).toISOString() },
      { symbol: "BTCUSDT", price: NaN, asOf: new Date(now).toISOString() },
      { symbol: "BTCUSDT", price: 0, asOf: "invalid" },
    ]) expect(freshQuotePrice(quote, "BTCUSDT", now)).toBeNull();
    expect(freshQuotePrice(undefined, "BTCUSDT", now)).toBeNull();
  });
  it("keeps open virtual positions and the selected asset within the 50-symbol API bound", () => {
    const visible = Array.from({ length: 50 }, (_, i) => `ASSET${i}USDT`);
    const symbols = quoteSubscription(visible, ["BTCUSDT", "ETHUSDT", "BTCUSDT"], "SOLUSDT");
    expect(symbols).toHaveLength(50);
    expect(symbols).toContain("BTCUSDT");
    expect(symbols).toContain("ETHUSDT");
    expect(symbols).toContain("SOLUSDT");
    expect(new Set(symbols).size).toBe(50);
  });
});

describe("scheduled recommendation scans", () => {
  it("shows the next UTC cron slot, including midnight rollover", () => {
    expect(nextScheduledScan(now).toISOString()).toBe("2026-10-15T14:17:00.000Z");
    expect(nextScheduledScan(Date.parse("2026-10-15T23:59:00Z")).toISOString()).toBe("2026-10-16T00:17:00.000Z");
    expect(nextScheduledScan(Date.parse("2026-10-15T16:17:00Z")).toISOString()).toBe("2026-10-15T17:17:00.000Z");
  });
  it("matches the real GitHub Actions schedule", () => {
    const workflow = readFileSync(new URL("../.github/workflows/market-data.yml", import.meta.url), "utf8");
    expect(SCAN_INTERVAL_HOURS).toBe(1);
    expect(workflow).toContain("cron: '17 * * * *'");
  });
});

describe("closed-candle refresh timing", () => {
  const HOUR = 3_600_000, base = Date.UTC(2026, 9, 20, 10, 0, 0);
  it("refreshes just after the next close when the newest candle is present", () => {
    const now = base + 20 * 60_000;
    expect(latestClosedCandleTime("1h", now)).toBe(base - 1);
    expect(nextCandleRefreshMs("1h", base - 1, now)).toBe(40 * 60_000 + 10_000);
    expect(nextCandleRefreshMs("1d", Date.UTC(2026, 9, 20) - 1, now)).toBe(Date.UTC(2026, 9, 21) - now + 10_000);
  });
  it("retries quickly while the exchange has not published the last close, then backs off", () => {
    expect(nextCandleRefreshMs("15m", base - 15 * 60_000 - 1, base + 20_000)).toBe(CANDLE_RETRY_MS);
    expect(nextCandleRefreshMs("1h", base - HOUR - 1, base + 10 * 60_000)).toBe(300_000);
    expect(nextCandleRefreshMs("1h", null, base)).toBe(CANDLE_RETRY_MS * 2);
  });
  it("caches chart history at the CDN until the next close only when it is complete", () => {
    expect(candleCacheSeconds("1h", base - 1, base + 59 * 60_000)).toBe(65);
    expect(candleCacheSeconds("1d", Date.UTC(2026, 9, 20) - 1, base)).toBe(3600);
    expect(candleCacheSeconds("4h", base - 4 * HOUR - 1, base + 1000)).toBe(15);
    expect(candleCacheSeconds("1h", null, base)).toBe(15);
  });
});

describe("compact API payloads", () => {
  it("drops model features and trims float noise without touching integers or strings", () => {
    const parsed = JSON.parse(compactJson({ setup: { features: { rsi: 1.5 }, price: 0.000012345678912345, score: 72, time: 1792418399999, id: "BTCUSDT-1h" }, list: [1 / 3] }));
    expect(parsed.setup.features).toBeUndefined();
    expect(parsed.setup.price).toBe(0.00001234567891);
    expect(parsed.setup.score).toBe(72);
    expect(parsed.setup.time).toBe(1792418399999);
    expect(parsed.setup.id).toBe("BTCUSDT-1h");
    expect(parsed.list[0]).toBe(0.3333333333);
  });
});
