import { describe, expect, it } from "vitest";
import type { Action, MarketSetup } from "../lib/types";
import { compareOpportunities, setupBlockers } from "../lib/opportunities";

function setup(symbol: string, action: Action, score: number): MarketSetup {
  const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: .5, macdHistogram: .5, atr: 2, trend: "bullish" as const };
  return { id: symbol, symbol, baseAsset: symbol.replace("USDT", ""), name: symbol, price: 101, change24h: 2, quoteVolume24h: 1e8, score, action, regime: "BULLISH", asOf: "2026-10-15T15:59:59.999Z", expiresAt: "2026-10-16T15:59:59.999Z", plan: null, indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1.2, buyPressure: .55, profile: [] }, sparkline: [] };
}

describe("opportunity eligibility is separate from technical score", () => {
  it("ranks qualified and conditional plans ahead of a high-score rejected market", () => {
    const input = [setup("ZKUSDT", "NO TRADE", 95), setup("BTCUSDT", "WAIT", 52), setup("ETHUSDT", "BUY", 91), setup("SOLUSDT", "WAIT", 67)];
    expect(input.slice().sort(compareOpportunities).map(s => s.symbol)).toEqual(["ETHUSDT", "SOLUSDT", "BTCUSDT", "ZKUSDT"]);
    expect(input[0].symbol).toBe("ZKUSDT");
    expect(input[0].score).toBe(95);
    expect(input[0].action).toBe("NO TRADE");
  });
  it("shows structured hard blockers and preserves explanations for older immutable records", () => {
    const rejected = setup("ZKUSDT", "NO TRADE", 82);
    rejected.reasons = ["Score is not probability.", "No valid structure/ATR stop within the 0.25–8% cost-adjusted risk bounds."];
    expect(setupBlockers(rejected)).toEqual([rejected.reasons[1]]);
    rejected.qualification = [{ id: "risk", label: "Risk plan", requiredFor: "plan", passed: false, detail: "Required stop risk 9.2% exceeds 8%." }];
    expect(setupBlockers(rejected)).toEqual(["Required stop risk 9.2% exceeds 8%."]);
    expect(setupBlockers(setup("BTCUSDT", "WAIT", 52))).toEqual([]);
  });
});
