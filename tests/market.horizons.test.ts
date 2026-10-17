import { describe, expect, it } from "vitest";
import type { Candle, ContextTimeframe } from "../lib/types";
import { INTERVAL_MS } from "../lib/market/binance";
import { analyzeSymbol, type SetupInput } from "../lib/market/setup";

const now = Date.UTC(2026, 9, 15, 12, 1);
const horizons: ContextTimeframe[] = ["1h", "4h", "1d"];

function series(interval: ContextTimeframe): Candle[] {
  const duration = INTERVAL_MS[interval];
  const end = Math.floor(now / duration) * duration;
  return Array.from({ length: 260 }, (_, index) => {
    const close = 100 + index * 0.1 + Math.sin(index * 0.8)
      + (interval === "4h" ? Math.max(0, index - 250) ** 2 * 0.025 : 0);
    const width = interval === "1h" ? 0.5 : interval === "4h" ? 0.7 : 1;
    const time = end - (260 - index) * duration;
    return { time, closeTime: time + duration - 1, open: close - 0.2,
      high: close + width, low: close - width, close, volume: 1000,
      quoteVolume: close * 1000, takerBuyVolume: interval === "1d" ? 450 : 550 };
  });
}

function input(): SetupInput {
  const candles = { "1h": series("1h"), "4h": series("4h"), "1d": series("1d") };
  candles["1h"][259] = { ...candles["1h"][259], open: 125.8, high: 127.1, low: 124.8,
    close: 126.9, volume: 1500, quoteVolume: 190350, takerBuyVolume: 1100 };
  candles["4h"][259] = { ...candles["4h"][259], open: 127.2, high: 128.9, low: 125.9,
    close: 128.5, volume: 900, quoteVolume: 115200, takerBuyVolume: 500 };
  candles["1d"][259] = { ...candles["1d"][259], open: 125.6, high: 127.4, low: 124,
    close: 127.1, volume: 1400, quoteVolume: 176400, takerBuyVolume: 700 };
  return { symbol: "BTCUSDT", baseAsset: "BTC", change24h: 2, quoteVolume24h: 50_000_000,
    tickSize: 0.01, stepSize: 0.00001, minNotional: 5, now, candles };
}

describe("independent causal setup horizons", () => {
  it.each(horizons)("can qualify BUY on %s when every required condition is present", (timeframe) => {
    const source = input();
    for (const interval of horizons) {
      source.candles[interval] = source.candles[interval].map((candle, index) => {
        const close = 100 + index * .1 + Math.sin(index * .8) + (interval === timeframe ? 0 : Math.max(0, index - 250) ** 2 * .01);
        return { ...candle, open: close - .2, high: close + .5, low: close - .5, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 550 };
      });
    }
    const latest = source.candles[timeframe].at(-1)!;
    const close = latest.close + 1.2;
    Object.assign(latest, { close, open: close - 1.1, high: close + .2, low: close - 1.5, volume: 1500, takerBuyVolume: 1050, quoteVolume: (close - .25) * 1500 });
    const result = analyzeSymbol(source, timeframe);
    expect(result.action).toBe("BUY");
    expect(result.qualification?.every(check => check.passed)).toBe(true);
    expect(result.plan!.riskPct).toBeLessThanOrEqual(8);
  });
  it("derives price, score, ATR stop and identity from each selected horizon", () => {
    const source = input();
    const results = horizons.map((timeframe) => analyzeSymbol(source, timeframe));
    expect(results.map((setup) => setup.price)).toEqual([126.9, 128.5, 127.1]);
    expect(new Set(results.map((setup) => setup.score)).size).toBe(3);
    expect(new Set(results.map((setup) => setup.id)).size).toBe(3);
    expect(new Set(results.map((setup) => setup.plan?.stopLoss)).size).toBe(3);
    for (const [index, setup] of results.entries()) {
      const timeframe = horizons[index];
      expect(setup.timeframe).toBe(timeframe);
      expect(setup.id).toContain(`-${timeframe}-`);
      expect(setup.id).toContain("cx-spot-5");
      expect(setup.asOf).toBe(new Date(source.candles[timeframe].at(-1)!.closeTime).toISOString());
      expect(setup.plan).not.toBeNull();
      expect(setup.plan!.entry).toBeCloseTo(Math.floor((setup.price - setup.indicators[timeframe].atr * 0.1) / 0.01 + 1e-10) * 0.01, 8);
      expect(setup.score).toBeGreaterThanOrEqual(0);
      expect(setup.score).toBeLessThanOrEqual(100);
      expect(setup.reasons.join(" ")).toMatch(/48-bar/i);
      expect(setup.reasons.join(" ")).toContain(timeframe.toUpperCase());
      expect(setup.reasons.join(" ")).not.toMatch(/48-hour/);
    }
    expect(analyzeSymbol(source)).toEqual(results[0]);
  });

  it.each(horizons)("freezes expiry and holding duration for %s at its decision close", (timeframe) => {
    const durations = { "1h": [24, 72], "4h": [72, 216], "1d": [168, 720] };
    const result = analyzeSymbol(input(), timeframe);
    expect(Date.parse(result.expiresAt) - Date.parse(result.asOf)).toBe(durations[timeframe][0] * INTERVAL_MS["1h"]);
    expect(result.holdingPeriodHours).toBe(durations[timeframe][1]);
  });

  it.each(horizons)("does not read unfinished or future context for %s", (timeframe) => {
    const source = input();
    const baseline = analyzeSymbol(source, timeframe);
    const cutoff = Date.parse(baseline.asOf);
    for (const interval of horizons) {
      source.candles[interval] = source.candles[interval].map((candle) => candle.closeTime > cutoff
        ? { ...candle, open: 900, high: 1000, low: 800, close: 950, quoteVolume: candle.volume * 940 }
        : candle);
      const last = source.candles[interval].at(-1)!;
      source.candles[interval].push({ ...last, time: last.time + INTERVAL_MS[interval],
        closeTime: last.closeTime + INTERVAL_MS[interval], open: 900, high: 1000, low: 800,
        close: 950, quoteVolume: last.volume * 940 });
    }
    expect(analyzeSymbol(source, timeframe)).toEqual(baseline);
  });

  it("daily qualification ignores bearish hourly/four-hour timing and their intentionally earlier as-of data", () => {
    const source = input();
    const baseline = analyzeSymbol(source, "1d");
    for (const interval of ["1h", "4h"] as const) {
      source.candles[interval] = source.candles[interval].map((candle, index) => {
        const close = 400 - index * 0.5;
        return { ...candle, open: close + 0.1, high: close + 0.5, low: close - 0.5, close,
          quoteVolume: close * candle.volume };
      });
    }
    const daily = analyzeSymbol(source, "1d");
    expect(daily.indicators["1h"].trend).toBe("bearish");
    expect(daily.indicators["4h"].trend).toBe("bearish");
    expect(daily.action).toBe(baseline.action);
    expect(daily.score).toBe(baseline.score);
    expect(daily.plan).toEqual(baseline.plan);
    expect(daily.regime).toBe("BULLISH");
    expect(daily.reasons.join(" ")).not.toMatch(/Rejected stale/);
  });

  it("withholds an unavailable daily horizon without substituting the hourly plan", () => {
    const source = input();
    source.candles["1h"] = source.candles["1h"].slice(-210);
    expect(() => analyzeSymbol(source, "1h")).not.toThrow();
    expect(() => analyzeSymbol(source, "4h")).not.toThrow();
    expect(() => analyzeSymbol(source, "1d")).toThrow(/Insufficient closed 1h history/);
  });

  it("daily structure and volume are independent of a new intraday volume spike", () => {
    const source = input();
    const baseline = analyzeSymbol(source, "1d");
    source.candles["1h"] = source.candles["1h"].map((candle) => ({ ...candle,
      volume: candle.volume * 100, quoteVolume: candle.quoteVolume * 100, takerBuyVolume: 0 }));
    const result = analyzeSymbol(source, "1d");
    expect(result.volume).toEqual(baseline.volume);
    expect(result.structure).toEqual(baseline.structure);
    expect(result.plan).toEqual(baseline.plan);
    expect(result.score).toBe(baseline.score);
  });
});
