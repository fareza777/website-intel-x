import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hour = 3_600_000;
function kline(index: number) {
  return [index * hour, "10", "12", "9", "11", "100", (index + 1) * hour - 1, "1100", 20, "60", "660", "0"];
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("public Binance candle retrieval", () => {
  it("filters the partial candle against exchange time despite a wrong machine clock", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return Response.json(String(url).includes("/time") ? { serverTime: 2 * hour + 500 } : [kline(0), kline(1), kline(2)]);
    });
    const { getCandles } = await import("../lib/market/binance");
    const candles = await getCandles("BTCUSDT", "1h", 3);
    expect(candles.map((c) => c.time)).toEqual([0, hour]);
    expect(candles[0].takerBuyVolume).toBe(60);
    expect(urls.every((url) => url.startsWith("https://data-api.binance.vision/api/v3/"))).toBe(true);
  });

  it("rejects impossible OHLC and discontinuous or duplicate timestamps", async () => {
    let rows = [kline(0), kline(2)];
    vi.stubGlobal("fetch", async (url: string) => Response.json(String(url).includes("/time") ? { serverTime: 5 * hour } : rows));
    let api = await import("../lib/market/binance");
    await expect(api.getCandles("BTCUSDT", "1h")).rejects.toThrow(/continu/i);
    vi.resetModules();
    const broken = kline(0); broken[2] = "8";
    rows = [broken];
    api = await import("../lib/market/binance");
    await expect(api.getCandles("BTCUSDT", "1h")).rejects.toThrow(/OHLC/i);
  });

  it("coalesces identical concurrent requests and caches successful GETs for 60 seconds", async () => {
    const calls = new Map<string, number>();
    vi.stubGlobal("fetch", async (url: string) => {
      const key = new URL(String(url)).pathname;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return Response.json(key.endsWith("time") ? { serverTime: 5 * hour } : [kline(0)]);
    });
    const api = await import("../lib/market/binance");
    const [first, second] = await Promise.all([api.getCandles("BTCUSDT", "1h"), api.getCandles("BTCUSDT", "1h")]);
    expect(first).toEqual(second);
    await api.getCandles("BTCUSDT", "1h");
    expect(calls.get("/api/v3/klines")).toBe(1);
    expect(calls.get("/api/v3/time")).toBe(1);
  });

  it("refreshes expired GET data instead of extending the cache on reads", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    let candleCalls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/time")) return Response.json({ serverTime: 5 * hour });
      candleCalls++;
      return Response.json([kline(0)]);
    });
    const api = await import("../lib/market/binance");
    const first = api.getCandles("BTCUSDT", "1h");
    await vi.runAllTimersAsync(); await first;
    await vi.advanceTimersByTimeAsync(30_000);
    await api.getCandles("BTCUSDT", "1h");
    await vi.advanceTimersByTimeAsync(30_001);
    const refreshed = api.getCandles("BTCUSDT", "1h");
    await vi.runAllTimersAsync(); await refreshed;
    expect(candleCalls).toBe(2);
  });

  it("waits for a short Retry-After before retrying the same host", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const attempts: { host: string; time: number }[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/time")) return Response.json({ serverTime: 5 * hour });
      attempts.push({ host: parsed.hostname, time: Date.now() });
      return attempts.length === 1 ? new Response("", { status: 429, headers: { "Retry-After": "1" } }) : Response.json([kline(0)]);
    });
    const api = await import("../lib/market/binance");
    const result = api.getCandles("BTCUSDT", "1h");
    await vi.runAllTimersAsync();
    expect(await result).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].host).toBe(attempts[0].host);
    expect(attempts[1].time - attempts[0].time).toBeGreaterThanOrEqual(1_000);
  });

  it("uses a fallback for server failure and sanitizes terminal errors", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const parsed = new URL(String(url)); hosts.push(parsed.hostname);
      if (parsed.hostname === "data-api.binance.vision") return new Response("secret internal error", { status: 503 });
      return Response.json(parsed.pathname.endsWith("time") ? { serverTime: 5 * hour } : [kline(0)]);
    });
    const api = await import("../lib/market/binance");
    expect(await api.getCandles("BTCUSDT", "1h")).toHaveLength(1);
    expect(hosts).toContain("api.binance.com");
  });

  it("honors a rate-limit cooldown globally without moving requests to a different host", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      hosts.push(new URL(String(url)).hostname);
      return new Response("do not expose this response", { status: 429, headers: { "Retry-After": "120" } });
    });
    const api = await import("../lib/market/binance");
    await expect(api.getCandles("BTCUSDT", "1h")).rejects.toThrow(/rate|cooldown/i);
    await expect(api.getOrderBook("ETHUSDT")).rejects.toThrow(/rate|cooldown/i);
    expect(new Set(hosts)).toEqual(new Set(["data-api.binance.vision"]));
  });

  it("returns true unavailable state when public market data cannot be fetched", async () => {
    vi.stubGlobal("fetch", async () => new Response("private provider detail", { status: 451 }));
    const { scanMarket } = await import("../lib/market/scanner");
    const snapshot = await scanMarket({ symbols: ["BTCUSDT"] });
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.setups).toEqual([]);
    expect(snapshot.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("private provider detail");
  });

  it("preserves the actual cached order-book observation time", async () => {
    const exchangeNow = Date.UTC(2026, 9, 15, 12);
    vi.useFakeTimers();
    vi.setSystemTime(exchangeNow);
    vi.stubGlobal("fetch", async (url: string) => Response.json(String(url).includes("/time") ? { serverTime: exchangeNow } : { lastUpdateId: 123, bids: [["10", "2"]], asks: [["11", "3"]] }));
    const api = await import("../lib/market/binance");
    const firstPending = api.getOrderBook("BTCUSDT");
    await vi.runAllTimersAsync();
    const first = await firstPending;
    await vi.advanceTimersByTimeAsync(30_000);
    const repeated = await api.getOrderBook("BTCUSDT");
    expect(repeated.asOf).toBe(first.asOf);
    expect(repeated.bids).toEqual([[10, 2]]);
  });

  it("keeps at most three full HTTP responses in flight and paces starts", async () => {
    let current = 0; let peak = 0;
    const starts: number[] = [];
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      paths.push(new URL(String(url)).pathname);
      starts.push(Date.now()); current++; peak = Math.max(peak, current);
      const data = String(url).includes("/time") ? { serverTime: 5 * hour } : [kline(0)];
      return { ok: true, status: 200, headers: new Headers(), json: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current--;
        return data;
      } } as Response;
    });
    const api = await import("../lib/market/binance");
    await Promise.all(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT", "XRPUSDT"].map((symbol) => api.getCandles(symbol, "1h")));
    expect(peak, `Full HTTP responses from: ${paths.join(", ")}`).toBeLessThanOrEqual(3);
    const gaps = starts.slice(1).map((time, index) => time - starts[index]);
    expect(Math.min(...gaps), `Request start gaps: ${gaps.join(", ")}`).toBeGreaterThanOrEqual(110);
  });
});

describe("bounded public spot quotes", () => {
  function ticker(symbol: string, price: string) { return { symbol, lastPrice: price, priceChangePercent: "0", quoteVolume: "1000", openTime: Date.now() - 86_400_000, closeTime: Date.now() }; }
  it("coalesces a normalized batch and preserves the exchange observation time across cache reads", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 15, 12));
    const requests: URL[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const parsed = new URL(String(url)); requests.push(parsed);
      return Response.json([ticker("BTCUSDT", "65000.25"), ticker("ETHUSDT", "2800.5")]);
    });
    const api = await import("../lib/market/binance");
    const first = await api.getSpotPrices([" ethusdt ", "BTCUSDT", "BTCUSDT"]);
    expect(first.map((quote) => [quote.symbol, quote.price])).toEqual([["BTCUSDT", 65000.25], ["ETHUSDT", 2800.5]]);
    expect(first[0].asOf).toBe(new Date(Date.UTC(2026, 9, 15, 12)).toISOString());
    await vi.advanceTimersByTimeAsync(5_000);
    const repeated = await api.getSpotPrices(["BTCUSDT", "ETHUSDT"]);
    expect(repeated).toEqual(first);
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe("/api/v3/ticker/24hr");
    expect(JSON.parse(requests[0].searchParams.get("symbols")!)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("receives a new exchange quote on the next 30-second display refresh", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 15, 12));
    let requests = 0;
    vi.stubGlobal("fetch", async () => Response.json([ticker("BTCUSDT", String(65000 + ++requests))]));
    const api = await import("../lib/market/binance");
    const first = await api.getSpotPrices(["BTCUSDT"]);
    await vi.advanceTimersByTimeAsync(30_000);
    const next = await api.getSpotPrices(["BTCUSDT"]);
    expect(requests).toBe(2);
    expect(next[0].price).not.toBe(first[0].price);
    expect(Date.parse(next[0].asOf) - Date.parse(first[0].asOf)).toBe(30_000);
  });

  it("rejects excessive or invalid batches and avoids requests for an empty portfolio", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", async (url: string) => { requests.push(new URL(String(url))); return Response.json([]); });
    const api = await import("../lib/market/binance");
    expect(await api.getSpotPrices([])).toEqual([]);
    await expect(api.getSpotPrices(Array.from({ length: 51 }, (_, index) => `ASSET${index}USDT`))).rejects.toThrow(/50/);
    await expect(api.getSpotPrices(["BTC/USDT"])).rejects.toThrow(/symbol/i);
    expect(requests).toEqual([]);
  });

  it.each([
    { payload: [{ symbol: "BTCUSDT", price: "NaN" }] },
    { payload: [{ symbol: "BTCUSDT", price: "0" }] },
    { payload: [{ symbol: "ETHUSDT", price: "2800" }] },
    { payload: [{ symbol: "BTCUSDT", price: "65000" }, { symbol: "BTCUSDT", price: "65001" }] },
  ])("rejects malformed, missing or duplicated requested quotes $payload", async ({ payload }) => {
    vi.stubGlobal("fetch", async () => Response.json(payload.map(row => ticker(row.symbol, row.price))));
    const api = await import("../lib/market/binance");
    await expect(api.getSpotPrices(["BTCUSDT"])).rejects.toThrow(/quote|price|symbol/i);
  });
});
