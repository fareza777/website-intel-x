import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { freshQuotePrice, nextScheduledScan, quoteSubscription, SCAN_INTERVAL_HOURS } from "../lib/live-market";

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
