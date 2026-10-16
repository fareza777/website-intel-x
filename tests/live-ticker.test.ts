import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshQuoteStats } from "../lib/live-market";

const now = Date.UTC(2026, 9, 16, 8);
const ticker = (symbol = "BTCUSDT", closeTime = now - 2_000) => ({ symbol, lastPrice: "65000.25", priceChangePercent: "2.5", quoteVolume: "123456789.12", openTime: closeTime - 86_400_000, closeTime });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("coherent live ticker observations", () => {
  it("returns price, change, volume and the actual exchange observation together", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (url: string) => { urls.push(new URL(url)); return Response.json([ticker()]); });
    const { getSpotPrices } = await import("../lib/market/binance");
    const quotes = await getSpotPrices(["BTCUSDT"]);
    expect(quotes[0]).toMatchObject({ symbol: "BTCUSDT", price: 65000.25, change24h: 2.5, quoteVolume24h: 123456789.12, asOf: new Date(now - 2_000).toISOString() });
    expect(urls[0].pathname).toBe("/api/v3/ticker/24hr");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await getSpotPrices(["BTCUSDT"])).toEqual(quotes);
    expect(urls).toHaveLength(1);
  });

  it("uses bounded twenty-symbol batches without changing identities", async () => {
    const requested: string[][] = [];
    vi.stubGlobal("fetch", async (url: string) => { const symbols = JSON.parse(new URL(url).searchParams.get("symbols")!); requested.push(symbols); return Response.json(symbols.map((symbol: string) => ticker(symbol))); });
    const { getSpotPrices } = await import("../lib/market/binance");
    const symbols = Array.from({ length: 50 }, (_, i) => `ASSET${i}USDT`);
    const promise = getSpotPrices(symbols); void promise.catch(() => {});
    await vi.runAllTimersAsync();
    expect((await promise).map(q => q.symbol)).toEqual(symbols.sort());
    expect(requested.map(s => s.length)).toEqual([20, 20, 10]);
  });

  it.each([
    { ...ticker(), closeTime: now - 120_001 },
    { ...ticker(), closeTime: now + 5_001 },
    { ...ticker(), priceChangePercent: "NaN" },
    { ...ticker(), priceChangePercent: "-101" },
    { ...ticker(), quoteVolume: "-1" },
    { ...ticker(), openTime: now },
  ])("rejects invalid or stale observations rather than relabeling them live", async row => {
    vi.stubGlobal("fetch", async () => Response.json([row]));
    const { getSpotPrices } = await import("../lib/market/binance");
    await expect(getSpotPrices(["BTCUSDT"])).rejects.toThrow();
  });

  it("never substitutes frozen or missing ticker statistics", () => {
    const quote = { symbol: "BTCUSDT", price: 65000, asOf: new Date(now).toISOString(), change24h: 2.5, quoteVolume24h: 1234 };
    expect(freshQuoteStats(quote, "BTCUSDT", now)).toEqual({ change24h: 2.5, quoteVolume24h: 1234 });
    expect(freshQuoteStats({ symbol: "BTCUSDT", price: 65000, asOf: quote.asOf }, "BTCUSDT", now)).toBeNull();
    expect(freshQuoteStats(quote, "ETHUSDT", now)).toBeNull();
    expect(freshQuoteStats(quote, "BTCUSDT", now + 120_001)).toBeNull();
  });
});
