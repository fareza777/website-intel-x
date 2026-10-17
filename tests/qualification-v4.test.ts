import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "../lib/types";
import { INTERVAL_MS } from "../lib/market/binance";
import { analyzeSymbol as analyzeWithModel, type SetupInput } from "../lib/market/setup";
// These tests exercise the rule path; the bundled calibration model is tested separately.
const analyzeSymbol = (input: Parameters<typeof analyzeWithModel>[0], timeframe?: Parameters<typeof analyzeWithModel>[1], context: Parameters<typeof analyzeWithModel>[2] = { model: null }) => analyzeWithModel(input, timeframe, context);
import { assessTradePlan, positionSize } from "../lib/market/risk";
import { createPaperAccount, importPaperAccount, reservePosition } from "../lib/paper";

const now = Date.UTC(2026, 9, 16, 12, 17);
function source(frame: Timeframe = "1d", width = 1): SetupInput {
  const candles = Object.fromEntries(Object.entries(INTERVAL_MS).map(([tf, duration]) => {
    const end = Math.floor(now / duration) * duration;
    return [tf, Array.from({ length: 350 }, (_, i) => {
      const close = 100 + i * .1 + Math.sin(i * .8) + (tf === frame ? 0 : Math.max(0, i - 300) ** 2 * .001);
      const time = end - (350 - i) * duration;
      return { time, closeTime: time + duration - 1, open: close - .2, high: close + width, low: close - width, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 498 };
    })];
  })) as Record<Timeframe, Candle[]>;
  const latest = candles[frame].at(-1)!;
  const close = Math.max(...candles[frame].slice(-21, -1).map(c => c.high)) + .1;
  Object.assign(latest, { open: close - .5, high: close + .2, low: close - width, close, volume: 1900, quoteVolume: close * 1900, takerBuyVolume: 1900 * .498 });
  return { symbol: "INJUSDT", baseAsset: "INJ", now, candles, quoteVolume24h: 100e6, change24h: 5, tickSize: .001, stepSize: .001, minNotional: 5 };
}
describe("v4 practical spot qualification", () => {
  it("qualifies a strong daily breakout even when 24-bar taker-buy is near 50%", () => {
    const setup = analyzeSymbol(source(), "1d");
    expect(setup.score).toBeGreaterThanOrEqual(78);
    expect(setup.action).toBe("BUY");
    expect(setup.qualification?.find(c => c.id === "participation")?.requiredFor).toBe("context");
    expect(setup.qualification?.find(c => c.id === "participation")?.passed).toBe(false);
    expect(setup.qualification?.find(c => c.id === "momentum")?.requiredFor).toBe("context");
    expect(setup.qualification?.filter(c => c.requiredFor !== "context").every(c => c.passed)).toBe(true);
    expect(setup.id).toContain("cx-spot-5");
  });
  it("keeps a high-scoring market on WAIT when no bullish price trigger has closed", () => {
    const input = source(), candle = input.candles["1d"].at(-1)!;
    candle.open = candle.close + .1; candle.high = candle.open + .2;
    const setup = analyzeSymbol(input, "1d");
    expect(setup.score).toBeGreaterThanOrEqual(78);
    expect(setup.action).toBe("WAIT"); expect(setup.entryModel).toBeUndefined();
    expect(setup.qualification?.find(c => c.id === "structure")?.passed).toBe(false);
  });
  it("accepts a valid daily structural stop above 8%, while sizing limits account loss", () => {
    const input = source("1d", 6), latest = input.candles["1d"].at(-1)!;
    const close = input.candles["1d"].at(-2)!.close + 1;
    Object.assign(latest, { close, open: close - .5, high: close + 6, low: close - 6, quoteVolume: close * latest.volume });
    const setup = analyzeSymbol(input, "1d");
    expect(setup.indicators["1d"].atr / setup.price * 100).toBeGreaterThan(6);
    expect(setup.action).toBe("BUY"); expect(setup.plan!.riskPct).toBeGreaterThan(8);
    expect(setup.plan!.riskPct).toBeLessThanOrEqual(25);
    const sized = positionSize(setup.plan!, 10000, 1);
    expect(sized.maxLoss).toBeLessThanOrEqual(100); expect(sized.notional).toBeLessThan(1000);
    const account = reservePosition(createPaperAccount(10000), setup, 1, new Date(now).toISOString());
    expect(importPaperAccount(JSON.stringify(account)).positions[0].signal.setup.id).toBe(setup.id);
  });
  it("retains mandatory rejection for illiquid, overextended and excessive daily risk", () => {
    const illiquid = source(); illiquid.quoteVolume24h = 1e6;
    expect(analyzeSymbol(illiquid, "1d").action).toBe("NO TRADE");
    expect(analyzeSymbol(source("1d", 20), "1d").action).toBe("NO TRADE");
    const far = assessTradePlan({ price: 100, atr: 5, support: 50, tickSize: .01, stepSize: .001, minNotional: 5, maxRiskPct: 25 });
    expect(far.reason).toBe("risk_too_high"); expect(far.review?.stopLoss).toBeLessThan(50);
  });
  it("supports explicit horizon risk limits without changing the legacy default or inventing closer stops", () => {
    const input = { price: 100, atr: 8, tickSize: .01, stepSize: .001, minNotional: 5 };
    expect(assessTradePlan(input).reason).toBe("risk_too_high");
    const swing = assessTradePlan({ ...input, maxRiskPct: 25 });
    expect(swing.plan).not.toBeNull(); expect(swing.review?.maximumLossPct).toBe(25);
    expect(positionSize(swing.plan!, 10000, 1).maxLoss).toBeLessThanOrEqual(100);
    expect(assessTradePlan({ ...input, maxRiskPct: Infinity }).reason).toBe("invalid_inputs");
  });
});
