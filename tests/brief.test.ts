import { describe, expect, it } from "vitest";
import type { MarketSetup, MarketSnapshot } from "../lib/types";
import { generateBrief, validateNarrative } from "../scripts/brief";

describe("optional paid narrative boundary", () => {
  const ids = ["BTCUSDT-1792065599999-cx-spot-1"];
  const good = { summary: "Momentum has improved, with confirmation still important.", plans: [{ id: ids[0], thesis: "The frozen plan aligns with the observed trend.", risks: ["Thin participation could weaken confirmation."], discipline: "Respect the supplied invalidation and avoid chasing." }] };
  it("allows the exact frozen id while keeping all model prose qualitative", () => {
    expect(validateNarrative(good, ids)).toEqual(good);
  });
  it.each(["Entry should be 100.", "Expect two percent upside.", "The target is guaranteed.", "Risk is ２ percent.", "The target doubles the available reward.", "Potential upside is threefold."])("rejects numeric or guaranteed prose: %s", (thesis) => {
    expect(() => validateNarrative({ ...good, plans: [{ ...good.plans[0], thesis }] }, ids)).toThrow();
  });
  it("rejects invented plan ids or model-authored numeric fields", () => {
    expect(() => validateNarrative({ ...good, plans: [{ ...good.plans[0], id: "invented" }] }, ids)).toThrow();
    expect(() => validateNarrative({ ...good, plans: [{ ...good.plans[0], entry: 999 }] }, ids)).toThrow();
  });
});

describe("manual narrative request budget", () => {
  const now = Date.parse("2026-10-15T12:17:00Z");
  function market(): MarketSnapshot {
    const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: 0.5, macdHistogram: 0.5, atr: 2, trend: "bullish" as const };
    const setup: MarketSetup = { id: "daily-123", symbol: "BTCUSDT", baseAsset: "BTC", name: "Bitcoin", timeframe: "1d", holdingPeriodHours: 720, price: 101, change24h: 2, quoteVolume24h: 1e9, score: 90, action: "BUY", regime: "BULLISH", asOf: "2026-10-14T23:59:59.999Z", expiresAt: "2026-10-21T23:59:59.999Z", plan: { entry: 100, entryZone: [99, 101], stopLoss: 95, targets: [{ price: 110, rr: 2, gainPct: 10 }, { price: 115, rr: 3, gainPct: 15 }, { price: 120, rr: 4, gainPct: 20 }], riskPct: 5, feeBps: 10, slippageBps: 5, tickSize: 0.01, stepSize: 0.001, minNotional: 5 }, indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1.5, buyPressure: 0.6, profile: [] }, sparkline: [] };
    return { version: 1, generatedAt: new Date(now).toISOString(), dataAsOf: setup.asOf, source: "test fixture", status: "live", universeSize: 1, scanned: 0, setups: [], timeframes: { "1h": [], "4h": [], "1d": [setup] }, errors: [], durationMs: 1, costs: { feeBps: 10, slippageBps: 5 } };
  }
  it("allows a fresh daily horizon without pretending its close is an hourly quote", async () => {
    const snapshot = market(); let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "The daily evidence is constructive.", plans: [{ id: "daily-123", thesis: "The supplied trend is constructive.", risks: ["A reversal could weaken the thesis."], discipline: "Use the frozen levels." }] }) } }] }); };
    const brief = await generateBrief(snapshot, { key: "fixture-key", model: "explicit-fixture-model", now, fetcher });
    expect(calls).toBe(1); expect(brief.plans[0].timeframe).toBe("1d");
    expect(brief.plans[0].plan!.entry).toBe(100); expect(snapshot.timeframes!["1d"][0].plan!.entry).toBe(100);
  });
  it("does not make a paid call without a qualifying BUY", async () => {
    const snapshot = market(); snapshot.timeframes!["1d"][0].action = "WAIT"; let calls = 0;
    const brief = await generateBrief(snapshot, { key: "", model: "", now, fetcher: async () => { calls++; throw new Error("must not call"); } });
    expect(calls).toBe(0); expect(brief.plans).toEqual([]);
  });
  it("uses one bounded paid request for at most three highest-quality frozen plans", async () => {
    const snapshot = market(); const original = snapshot.timeframes!["1d"][0];
    snapshot.timeframes!["1d"] = [85, 81, 92, 79, 88].map((score) => ({ ...structuredClone(original), id: `score-${score}`, score }));
    let calls = 0;
    const brief = await generateBrief(snapshot, { key: "fixture-key", model: "explicit-fixture-model", now, fetcher: async (url, options) => {
      calls++; expect(String(url)).toBe("https://api.x.ai/v1/chat/completions");
      expect(JSON.parse(options!.body as string).max_tokens).toBeLessThanOrEqual(1_000);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Participation supports the supplied evidence.", plans: ["score-92", "score-88", "score-85"].map((id) => ({ id, thesis: "The supplied trend is constructive.", risks: ["A reversal remains possible."], discipline: "Respect the frozen plan." })) }) } }] });
    } });
    expect(calls).toBe(1); expect(brief.plans.map((plan) => plan.id)).toEqual(["score-92", "score-88", "score-85"]);
    expect(brief.plans.every((plan) => plan.plan!.entry === 100)).toBe(true);
  });
});
