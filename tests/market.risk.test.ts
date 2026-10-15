import { describe, expect, it } from "vitest";
import type { Candle, Timeframe, TradePlan } from "../lib/types";
import { makeTradePlan, positionSize } from "../lib/market/risk";
import { analyzeSymbol } from "../lib/market/setup";

const hour = 3_600_000;
const plan: TradePlan = { entry: 100, entryZone: [99, 101], stopLoss: 95, targets: [{ price: 112, rr: 2, gainPct: 12 }], riskPct: 5.3, feeBps: 10, slippageBps: 5, tickSize: 0.01, stepSize: 0.01, minNotional: 5 };

function series(interval: Timeframe, end: number, bearish = false): Candle[] {
  const duration = interval === "1h" ? hour : interval === "4h" ? 4 * hour : 24 * hour;
  const alignedEnd = Math.floor(end / duration) * duration;
  return Array.from({ length: 260 }, (_, index) => {
    const close = bearish ? 300 - index * 0.5 : 100 + index * 0.3 + Math.sin(index / 3) * 0.25;
    const time = alignedEnd - (260 - index) * duration;
    return { time, closeTime: time + duration - 1, open: close - (bearish ? -0.2 : 0.2), high: close + 0.5, low: close - 0.5, close, volume: 1_000, quoteVolume: close * 1_000, takerBuyVolume: 550 };
  });
}

describe("cost-aware spot position sizing", () => {
  it("includes fees and slippage on both sides before rounding down the lot", () => {
    const sized = positionSize(plan, 1_000, 1);
    // Per-unit loss = 100*1.0005*1.001 - 95*.9995*.999 = 5.2925025.
    expect(sized.quantity).toBe(1.88);
    expect(sized.notional).toBe(188);
    expect(sized.riskAmount).toBe(10);
    expect(sized.maxLoss).toBeCloseTo(9.9499047, 6);
  });

  it("caps the position by available capital including entry costs", () => {
    const sized = positionSize(plan, 100, 100);
    expect(sized.quantity).toBe(0.99);
    expect(sized.quantity * 100 * 1.0005 * 1.001).toBeLessThanOrEqual(100);
  });

  it("returns no position below exchange minimum notional or for invalid risk", () => {
    expect(positionSize(plan, 10, 0.1).quantity).toBe(0);
    expect(positionSize(plan, 1_000, 0).quantity).toBe(0);
    expect(positionSize({ ...plan, stopLoss: 101 }, 1_000, 1).quantity).toBe(0);
  });

  it("constructs ordered tick-rounded targets at net reward-to-risk after costs", () => {
    const result = makeTradePlan({ price: 100, atr: 2, support: 96, tickSize: 0.05, stepSize: 0.001, minNotional: 5 });
    expect(result).not.toBeNull();
    expect(result!.stopLoss).toBeLessThan(result!.entryZone[0]);
    expect(result!.entryZone[0]).toBeLessThanOrEqual(result!.entry);
    expect(result!.entryZone[1]).toBeGreaterThanOrEqual(result!.entry);
    expect(result!.targets).toHaveLength(3);
    let previous = result!.entry;
    for (const target of result!.targets) {
      const debit = result!.entry * 1.0005 * 1.001;
      const stopCredit = result!.stopLoss * 0.9995 * 0.999;
      const targetCredit = target.price * 0.9995 * 0.999;
      expect(target.price).toBeGreaterThan(previous);
      expect(target.rr).toBeCloseTo((targetCredit - debit) / (debit - stopCredit), 7);
      expect(target.price / 0.05).toBeCloseTo(Math.round(target.price / 0.05), 7);
      previous = target.price;
    }
    expect(result!.targets[0].rr).toBeGreaterThanOrEqual(2);
  });
});

describe("deterministic setup rejection", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  function analyze(bearish = false, quoteVolume24h = 50_000_000, evaluationTime = now) {
    return analyzeSymbol({ symbol: "BTCUSDT", baseAsset: "BTC", change24h: 2, quoteVolume24h, tickSize: 0.01, stepSize: 0.00001, minNotional: 5, now: evaluationTime, candles: { "1h": series("1h", now, bearish), "4h": series("4h", now, bearish), "1d": series("1d", now, bearish) } });
  }

  it("rejects bearish higher timeframe agreement instead of proposing a spot short", () => {
    const result = analyze(true);
    expect(result.action).toBe("NO TRADE");
    expect(result.plan).toBeNull();
    expect(result.regime).toBe("BEARISH");
  });

  it("rejects stale or illiquid setups with an explicit explanation", () => {
    expect(analyze(false, 1_000).action).toBe("NO TRADE");
    const stale = analyze(false, 50_000_000, now + 3 * hour);
    expect(stale.action).toBe("NO TRADE");
    expect(stale.reasons.join(" ")).toMatch(/stale/i);
    expect(stale.plan).toBeNull();
  });

  it("uses a fixed candle timestamp in recommendation identity and exposes approximation limits", () => {
    const first = analyze();
    const repeated = analyze(false, 50_000_000, now + 10_000);
    expect(first.id).toBe(repeated.id);
    expect(first.name).toBe("Bitcoin");
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.reasons.join(" ")).toMatch(/approximate/i);
    expect(first.reasons.join(" ")).toMatch(/not (a )?probability/i);
  });

  function qualifiedInput(confirmed: boolean) {
    const candles = { "1h": series("1h", now), "4h": series("4h", now), "1d": series("1d", now) };
    for (const interval of ["1h", "4h", "1d"] as const) {
      candles[interval] = candles[interval].map((candle, index) => {
        const close = 100 + index * 0.1 + Math.sin(index * 0.8) + (interval === "4h" ? Math.max(0, index - 250) ** 2 * 0.025 : 0);
        return { ...candle, open: close - 0.2, close, high: close + 0.5, low: close - 0.5, quoteVolume: close * 1_000 };
      });
    }
    if (confirmed) {
      const latest = candles["1h"].at(-1)!;
      candles["1h"][259] = { ...latest, open: 125.8, high: 127.1, low: 124.8, close: 126.9, volume: 1_500, quoteVolume: 190_350, takerBuyVolume: 1_100 };
    }
    return { symbol: "BTCUSDT", baseAsset: "BTC", change24h: 2, quoteVolume24h: 50_000_000, tickSize: 0.01, stepSize: 0.00001, minNotional: 5, now, candles };
  }

  it("reserves BUY for fresh higher-timeframe agreement with current price and volume confirmation", () => {
    const result = analyzeSymbol(qualifiedInput(true));
    expect(result.action).toBe("BUY");
    expect(result.plan).not.toBeNull();
    expect(result.indicators["4h"].trend).toBe("bullish");
    expect(result.indicators["1d"].trend).toBe("bullish");
    expect(result.volume.relativeVolume).toBe(1.5);
    expect(result.score).toBeGreaterThanOrEqual(78);
  });

  it("qualifies BUY through a recently confirmed structure break without a 20-hour high breakout", () => {
    const input = qualifiedInput(true);
    // An older high is above the decision price, while a later, lower confirmed swing is broken.
    input.candles["1h"][241].high = 130;
    const latest = input.candles["1h"][259];
    const result = analyzeSymbol(input);
    expect(latest.close).toBeLessThan(130);
    expect(result.action).toBe("BUY");
    expect(result.structure).toContainEqual(expect.objectContaining({ type: "BOS", direction: "bullish", time: latest.closeTime }));
    expect(result.plan).not.toBeNull();
    expect(result.confirmations.some((confirmation) => /recent bullish structure/i.test(confirmation))).toBe(true);
  });

  it("does not reuse an older bullish structure event as current BUY confirmation", () => {
    const input = qualifiedInput(true);
    input.candles["1h"][241].high = 130;
    input.candles["1h"][259].close = 126.5;
    input.candles["1h"][259].quoteVolume = 189_750;
    const latest = input.candles["1h"][259];
    const result = analyzeSymbol(input);
    expect(result.structure.some((event) => event.type === "BOS" && event.direction === "bullish" && event.time < latest.closeTime - 2 * hour)).toBe(true);
    expect(result.action).toBe("WAIT");
  });

  it("exposes the last closed hourly price even when an unfinished candle trades elsewhere", () => {
    const input = qualifiedInput(true);
    const closed = input.candles["1h"][259];
    input.candles["1h"].push({ ...closed, time: now, closeTime: now + hour - 1, open: 500, high: 1_000, low: 400, close: 999 });
    const result = analyzeSymbol(input);
    expect(result.price).toBe(126.9);
    expect(result.asOf).toBe(new Date(closed.closeTime).toISOString());
    expect(result.action).toBe("BUY");
  });

  it("publishes a conditional WAIT plan when higher timeframes agree but fresh volume is missing", () => {
    const result = analyzeSymbol(qualifiedInput(false));
    expect(result.action).toBe("WAIT");
    expect(result.plan).not.toBeNull();
    expect(result.confirmations.join(" ")).toMatch(/Await/);
  });

  it("does not read higher-timeframe candles that closed after the hourly decision timestamp", () => {
    const input = qualifiedInput(false);
    input.now = now + 5 * hour;
    const baseline = analyzeSymbol(input);
    const last = input.candles["4h"].at(-1)!;
    input.candles["4h"] = [...input.candles["4h"], { ...last, time: now, closeTime: now + 4 * hour - 1, open: 300, high: 400, low: 200, close: 350 }];
    const withFuture = analyzeSymbol(input);
    expect(withFuture.indicators).toEqual(baseline.indicators);
    expect(withFuture.id).toBe(baseline.id);
  });
});
