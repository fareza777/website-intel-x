import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Timeframe } from "../lib/types";

const now = Date.UTC(2026, 9, 15, 12, 1);
const durations: Record<Timeframe, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
function exchangeSymbol(baseAsset: string) {
  return { symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true,
    filters: [{ filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" }, { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000000", stepSize: "0.001" }, { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true, avgPriceMins: 5 }] };
}
function candles(interval: Timeframe, count = 261) {
  const duration = durations[interval];
  const end = Math.floor(now / duration) * duration;
  return Array.from({ length: count }, (_, index) => {
    const time = end - (count - 1 - index) * duration;
    const close = 100 + index * 0.1 + Math.sin(index * 0.8);
    return [time, String(close - 0.2), String(close + 0.5), String(close - 0.5), String(close), "1000", time + duration - 1, String(close * 1000), 100, "550", String(close * 550), "0"];
  });
}
function feed(bases: string[], failedSymbol?: string, counts: Partial<Record<Timeframe, number>> = {}) {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const parsed = new URL(String(url)); requests.push(parsed);
    if (parsed.pathname.endsWith("/time")) return Response.json({ serverTime: now });
    if (parsed.pathname.endsWith("/exchangeInfo")) return Response.json({ timezone: "UTC", serverTime: now, rateLimits: [], exchangeFilters: [], symbols: bases.map(exchangeSymbol) });
    if (parsed.pathname.endsWith("/ticker/24hr")) return Response.json(bases.map((base, index) => ({ symbol: `${base}USDT`, lastPrice: "125", priceChangePercent: "2", quoteVolume: String(50_000_000 - index * 10_000) })));
    const interval = parsed.searchParams.get("interval") as Timeframe;
    return Response.json(candles(interval, counts[interval] ?? (parsed.searchParams.get("symbol") === failedSymbol ? 100 : 261)));
  });
  return requests;
}

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("scanner universe and data status", () => {
  it("allows a one-symbol explicit watchlist and reports missing markets as partial", async () => {
    const requests = feed(["BTC", "ETH"], "ETHUSDT");
    const { scanMarket } = await import("../lib/market/scanner");
    const result = await scanMarket({ symbols: ["BTCUSDT", "ETHUSDT", "MISSINGUSDT"] });
    expect(result.status).toBe("partial");
    expect(result.scanned).toBe(1);
    expect(result.universeSize).toBe(3);
    expect(result.setups.map((setup) => setup.symbol)).toEqual(["BTCUSDT"]);
    expect(result.errors.map((error) => error.symbol)).toEqual(["ETHUSDT", "MISSINGUSDT"]);
    expect(requests.filter((url) => url.pathname.endsWith("/exchangeInfo"))).toHaveLength(1);
    expect(requests.filter((url) => url.pathname.endsWith("/ticker/24hr"))).toHaveLength(1);
    const one = await scanMarket({ symbols: ["BTCUSDT"] });
    expect(one.status).toBe("live");
    expect(one.scanned).toBe(1);
  });

  it("requires 20 liquid markets for an automatic universe and validates bounds", async () => {
    feed(["BTC", "ETH", "USDC"]);
    const { scanMarket } = await import("../lib/market/scanner");
    const small = await scanMarket();
    expect(small.status).toBe("unavailable");
    expect(small.setups).toEqual([]);
    expect(small.errors[0].message).toMatch(/20 liquid/);
    expect((await scanMarket({ limit: 19 })).status).toBe("unavailable");
    expect((await scanMarket({ limit: 51 })).status).toBe("unavailable");
  });

  it("keeps Jupiter spot while rejecting stablecoins and actual leveraged suffixes", async () => {
    feed(["JUP", "USDC", "BTCUP", "ETHDOWN", "BTCBULL", "ETHBEAR"]);
    const { scanMarket } = await import("../lib/market/scanner");
    const result = await scanMarket({ symbols: ["JUPUSDT", "USDCUSDT", "BTCUPUSDT", "ETHDOWNUSDT", "BTCBULLUSDT", "ETHBEARUSDT"] });
    expect(result.setups.map((setup) => setup.symbol)).toEqual(["JUPUSDT"]);
    expect(result.status).toBe("partial");
    expect(result.errors).toHaveLength(5);
  });

  it("rejects the newly listed U stablecoin and tokenized leveraged equity products", async () => {
    feed(["BTC", "U", "SOXLB", "CRCLB", "SNDKB", "SPCXB"]);
    const { scanMarket } = await import("../lib/market/scanner");
    const result = await scanMarket({ symbols: ["BTCUSDT", "UUSDT", "SOXLBUSDT", "CRCLBUSDT", "SNDKBUSDT", "SPCXBUSDT"] });
    expect(result.setups.map((setup) => setup.symbol)).toEqual(["BTCUSDT"]);
    expect(result.errors).toHaveLength(5);
  });

  it("accepts valid single-letter crypto base assets in an explicit watchlist", async () => {
    feed(["BTC", "F"]);
    const { scanMarket } = await import("../lib/market/scanner");
    const result = await scanMarket({ symbols: ["BTCUSDT", "FUSDT"] });
    expect(result.status).toBe("live");
    expect(result.setups.map((setup) => setup.symbol)).toEqual(["BTCUSDT", "FUSDT"]);
  });

  it("chooses the highest-volume 30 markets by default and caps an expanded scan at 50", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const bases = Array.from({ length: 55 }, (_, index) => `ASSET${String(index).padStart(2, "0")}`);
    const requests = feed(bases);
    const { scanMarket } = await import("../lib/market/scanner");
    const firstPending = scanMarket();
    await vi.runAllTimersAsync();
    const first = await firstPending;
    expect(first.status).toBe("live");
    expect(first.universeSize).toBe(30);
    expect(first.setups.map((setup) => setup.symbol)).toEqual(bases.slice(0, 30).map((base) => `${base}USDT`));
    expect(requests.filter((url) => url.pathname.endsWith("/klines"))).toHaveLength(124); // 30 markets × 4 frames + BTC market context
    expect(first.timeframes?.["1h"]).toEqual(first.setups);
    expect(first.timeframes?.["4h"]).toHaveLength(30);
    expect(first.timeframes?.["1d"]).toHaveLength(30);
    const expandedPending = scanMarket({ limit: 50 });
    await vi.runAllTimersAsync();
    const expanded = await expandedPending;
    expect(expanded.universeSize).toBe(50);
    expect(expanded.scanned).toBe(50);
    expect(requests.filter((url) => url.pathname.endsWith("/exchangeInfo"))).toHaveLength(1);
    expect(requests.filter((url) => url.pathname.endsWith("/ticker/24hr"))).toHaveLength(1);
    expect((await scanMarket({ symbols: bases.map((base) => `${base}USDT`) })).status).toBe("unavailable");
  });

  it("fetches each timeframe once and isolates an insufficient daily decision context", async () => {
    const requests = feed(["BTC"], undefined, { "1h": 211 });
    const { scanMarket } = await import("../lib/market/scanner");
    const result = await scanMarket({ symbols: ["BTCUSDT"] });
    expect(result.status).toBe("partial");
    expect(result.scanned).toBe(1);
    expect(result.timeframes?.["1h"]).toEqual(result.setups);
    expect(result.timeframes?.["4h"]).toHaveLength(1);
    expect(result.timeframes?.["1d"]).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/1D.*Insufficient closed 1h/i);
    expect(requests.filter((url) => url.pathname.endsWith("/klines"))).toHaveLength(4);
  });
});
