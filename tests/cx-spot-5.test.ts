import { describe, expect, it } from "vitest";
import type { Candle, ContextTimeframe, MarketSetup, TrackedSignal, Timeframe } from "../lib/types";
import { INTERVAL_MS } from "../lib/market/binance";
import { analyzeSymbol, type SetupInput } from "../lib/market/setup";
import { makeTradePlan, withExitProfile } from "../lib/market/risk";
import { DEFAULT_EXIT_PROFILE, EXIT_PROFILES, MAX_PORTFOLIO_HEAT_PCT } from "../lib/market/policy";
import { adx, percentileRank, volumeZ } from "../lib/market/features";
import { auc, BUNDLED_MODEL, FEATURE_KEYS, FEATURE_VERSION, predictProbability, trainLogistic, type CalibrationModel, type HorizonModel } from "../lib/market/model";
import { advanceSignal } from "../lib/tracking";
import { applyPaperUpdates, createPaperAccount, importPaperAccount, openRisk, positionValue, previewPosition, reservePosition, settlePaperPosition } from "../lib/paper";
import { bootstrapMean, monteCarloDrawdown, summarizeHorizon } from "../lib/research/stats";
import { fitHorizon, simulateOutcome, type Candidate } from "../lib/research/training";
import { setupSchema } from "../lib/validation";

const management = { kind: "scale-trail" as const, partialFraction: .5, breakevenStop: 100.31, atr: 2, trailMultiple: 3, profile: "test" };
function managedSetup(symbol = "BTCUSDT"): MarketSetup {
  const indicator = { ema21: 100, ema50: 98, ema200: 90, rsi: 55, macd: 1, macdSignal: .5, macdHistogram: .5, atr: 2, trend: "bullish" as const };
  return { id: `${symbol}-1`, symbol, baseAsset: symbol.replace("USDT", ""), name: symbol, price: 101, change24h: 2, quoteVolume24h: 1e9, score: 80, action: "BUY", regime: "BULLISH",
    asOf: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T01:00:00Z", plan: { entry: 100, entryZone: [99, 101], stopLoss: 95,
      targets: [{ price: 105, rr: 1, gainPct: 5 }, { price: 110, rr: 2, gainPct: 10 }, { price: 120, rr: 4, gainPct: 20 }], riskPct: 5, feeBps: 10, slippageBps: 5, tickSize: .01, stepSize: .001, minNotional: 5, management },
    indicators: { "1h": indicator, "4h": indicator, "1d": indicator }, reasons: [], confirmations: [], invalidations: [], structure: [], volume: { vwap: 100, poc: 100, relativeVolume: 1.5, buyPressure: .6, profile: [] }, sparkline: [] };
}
function bar(hour: number, open: number, high: number, low: number, close: number): Candle {
  const time = Date.parse(`2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`);
  return { time, closeTime: time + 3599999, open, high, low, close, volume: 100, quoteVolume: 10000, takerBuyVolume: 50 };
}
function signal(setup = managedSetup()): TrackedSignal {
  return { setup, publishedAt: "2026-01-01T01:01:00Z", status: "PENDING", enteredAt: null, entryFill: null, exitAt: null, exitFill: null, lastEvaluatedTime: 0, highestTarget: 0, realizedReturnPct: null, events: [] };
}
const later = Date.parse("2026-01-01T12:00:00Z"), slip = .9995;

describe("cx-spot-5 managed exits", () => {
  it("scales out at TP1 and exits the remainder at breakeven with one blended fill", () => {
    const result = advanceSignal(signal(), [bar(2, 101, 102, 99.5, 101), bar(3, 101, 106, 100.5, 105), bar(4, 104, 104.5, 100, 101)], later);
    expect(result.partial?.fill).toBeCloseTo(105 * slip);
    expect(result.status).toBe("CLOSED");
    expect(result.exitFill).toBeCloseTo(.5 * 105 * slip + .5 * 100.31 * slip);
    expect(result.realizedReturnPct!).toBeGreaterThan(0);
    expect(result.events.map(e => e.type)).toEqual(["ENTRY", "TP1", "SCALE OUT", "TRAIL EXIT"]);
  });
  it("trails the remainder from completed highs only", () => {
    const result = advanceSignal(signal(), [bar(2, 101, 102, 99.5, 101), bar(3, 101, 106, 100.5, 105), bar(4, 106, 112, 105, 111), bar(5, 110, 110.5, 105.5, 106)], later);
    expect(result.highestTarget).toBe(2);
    expect(result.exitFill).toBeCloseTo(.5 * 105 * slip + .5 * 106 * slip);
    expect(result.status).toBe("CLOSED");
  });
  it("resolves a same-bar TP1 and dip to breakeven stop-first", () => {
    const result = advanceSignal(signal(), [bar(2, 101, 102, 99.5, 101), bar(3, 101, 106, 100.2, 104)], later);
    expect(result.exitAt).toBe(new Date(Date.parse("2026-01-01T03:59:59.999Z")).toISOString());
    expect(result.exitFill).toBeCloseTo(.5 * 105 * slip + .5 * 100.31 * slip);
  });
  it("takes the full planned loss when the stop comes first", () => {
    const result = advanceSignal(signal(), [bar(2, 101, 102, 99.5, 101), bar(3, 99, 100, 94, 95)], later);
    expect(result.status).toBe("STOPPED");
    expect(result.partial ?? null).toBeNull();
    expect(result.exitFill).toBeCloseTo(95 * slip);
  });
  it("keeps legacy plans on the full-position TP3 rule", () => {
    const legacy = managedSetup(); delete legacy.plan!.management;
    const result = advanceSignal(signal(legacy), [bar(2, 101, 102, 99.5, 101), bar(3, 101, 106, 100.5, 105), bar(4, 104, 104.5, 100, 101)], later);
    expect(result.status).toBe("TP1");
    expect(result.partial ?? null).toBeNull();
  });
  it("builds managed targets from an exit profile with a costed breakeven below TP1", () => {
    const plan = makeTradePlan({ price: 100, atr: 1, tickSize: .01, stepSize: .001, minNotional: 5, exit: DEFAULT_EXIT_PROFILE })!;
    expect(plan.targets.map(t => Math.round(t.rr * 10) / 10)).toEqual([1.5, 2.8, 4]);
    expect(plan.management!.breakevenStop).toBeGreaterThan(plan.entry);
    expect(plan.management!.breakevenStop).toBeLessThan(plan.targets[0].price);
    const other = withExitProfile(plan, EXIT_PROFILES[0], 1)!;
    expect(other.entry).toBe(plan.entry); expect(other.stopLoss).toBe(plan.stopLoss);
    expect(other.targets[0].rr).toBeCloseTo(1, 1);
    expect(withExitProfile(plan, undefined, 1)!.management).toBeUndefined();
  });
});

describe("cx-spot-5 virtual portfolio", () => {
  const at = "2026-01-01T00:30:00Z";
  it("applies the setup's risk multiplier and the portfolio heat cap", () => {
    const account = createPaperAccount(10_000);
    const half = { ...managedSetup(), sizing: { riskMultiplier: .5, reasons: ["test"] } };
    expect(previewPosition(account, half, 1, at).maxLoss).toBeLessThanOrEqual(50);
    const first = reservePosition(account, managedSetup(), 5, at);
    expect(openRisk(first)).toBeLessThanOrEqual(500);
    expect(() => previewPosition(first, managedSetup("ETHUSDT"), 5, at)).toThrow(new RegExp(`maximum ${MAX_PORTFOLIO_HEAT_PCT}%`));
  });
  it("preserves managed plans and scale-outs through export/import and values the sold half", () => {
    let account = reservePosition(createPaperAccount(10_000), managedSetup(), 1, at);
    const advanced = advanceSignal(account.positions[0].signal, [bar(1, 101, 101.5, 100.5, 101), bar(2, 101, 102, 99.5, 101), bar(3, 101, 106, 100.5, 105)], later);
    expect(advanced.partial).toBeTruthy();
    account = applyPaperUpdates(account, [advanced]);
    const restored = importPaperAccount(JSON.stringify(account));
    expect(restored.positions[0].signal.setup.plan!.management).toEqual(management);
    expect(restored.positions[0].signal.partial).toEqual(advanced.partial);
    const value = positionValue(restored.positions[0], 100);
    expect(value).toBeCloseTo(restored.positions[0].quantity * (.5 * 105 * slip + .5 * 100 * slip) * .999);
    const closed = settlePaperPosition(restored, "BTCUSDT-1", at, { kind: "close", quote: { symbol: "BTCUSDT", price: 100, asOf: "2026-01-01T03:59:59Z" } }, "2026-01-01T04:00:30Z");
    expect(closed.positions[0].signal.exitFill).toBeCloseTo(.5 * 105 * slip + .5 * 100 * slip);
  });
});

const now = Date.UTC(2026, 9, 15, 12, 1);
const horizons: ContextTimeframe[] = ["1h", "4h", "1d"];
function series(interval: Timeframe, trend = .1): Candle[] {
  const duration = INTERVAL_MS[interval], end = Math.floor(now / duration) * duration;
  return Array.from({ length: 260 }, (_, index) => {
    const close = 100 + index * trend + Math.sin(index * .8), time = end - (260 - index) * duration;
    return { time, closeTime: time + duration - 1, open: close - .2, high: close + .5, low: close - .5, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 550 };
  });
}
function qualifiedInput(): SetupInput {
  const candles = { "1h": series("1h"), "4h": series("4h"), "1d": series("1d") } as SetupInput["candles"];
  for (const interval of horizons) {
    candles[interval] = candles[interval].map((candle, index) => {
      const close = 100 + index * .1 + Math.sin(index * .8) + (interval === "1h" ? 0 : Math.max(0, index - 250) ** 2 * .01);
      return { ...candle, open: close - .2, high: close + .5, low: close - .5, close, volume: 1000, quoteVolume: close * 1000, takerBuyVolume: 550 };
    });
  }
  const latest = candles["1h"].at(-1)!, close = latest.close + 1.2;
  Object.assign(latest, { close, open: close - 1.1, high: close + .2, low: close - 1.5, volume: 1500, takerBuyVolume: 1050, quoteVolume: (close - .25) * 1500 });
  return { symbol: "ETHUSDT", baseAsset: "ETH", change24h: 2, quoteVolume24h: 50_000_000, tickSize: .01, stepSize: .00001, minNotional: 5, now, candles };
}
function horizonModel(bias: number, validated = true): HorizonModel {
  return { weights: Array(FEATURE_KEYS.length).fill(0), bias, means: Array(FEATURE_KEYS.length).fill(0), scales: Array(FEATURE_KEYS.length).fill(1), exitProfile: EXIT_PROFILES[0].id,
    minimumEdgeR: .1, avgWinR: 1.5, avgLossR: 1, samples: 500, wins: 250, validated, reason: "test",
    validation: { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z", samples: 150, baseWinRate: .5, auc: .6, brier: .2, allMeanR: 0, selected: 40, selectedWinRate: .6, selectedMeanR: .3, calibration: [] } };
}
function model(bias: number, validated = true): CalibrationModel {
  return { version: "test-model", featureVersion: FEATURE_VERSION, strategyVersion: "cx-spot-5", generatedAt: null, trainedFrom: null, trainedThrough: "2026-06-01T00:00:00.000Z", universe: [],
    horizons: { "1h": horizonModel(bias, validated), "15m": horizonModel(bias, validated) }, notes: [] };
}

describe("cx-spot-5 qualification", () => {
  it("qualifies with rules when no model exists, and records features, sizing and regime", () => {
    const setup = analyzeSymbol(qualifiedInput(), "1h", { model: null });
    expect(setup.action).toBe("BUY");
    expect(setup.features && Object.keys(setup.features)).toEqual(FEATURE_KEYS);
    expect(setup.edge).toBeNull();
    expect(setup.plan!.management?.profile).toBe(DEFAULT_EXIT_PROFILE.id);
    expect(setup.sizing!.riskMultiplier).toBeGreaterThan(0);
    expect(setupSchema.parse(setup).features).toEqual(setup.features);
  });
  it("blocks BUY in a risk-off market (bearish BTC and weak breadth)", () => {
    const btc = Object.fromEntries((["15m", "1h", "4h", "1d"] as Timeframe[]).map(frame => [frame, series(frame, -.1)]));
    const setup = analyzeSymbol(qualifiedInput(), "1h", { model: null, btc, breadth: { "1h": .1 } });
    expect(setup.market!.riskOff).toBe(true);
    expect(setup.action).not.toBe("BUY");
    expect(setup.qualification!.find(check => check.id === "regime")!.passed).toBe(false);
  });
  it("lets a validated model replace the score floor and veto a negative edge", () => {
    const positive = analyzeSymbol(qualifiedInput(), "1h", { model: model(3) });
    expect(positive.action).toBe("BUY");
    expect(positive.edge!.validated).toBe(true);
    expect(positive.qualification!.find(check => check.id === "score")!.requiredFor).toBe("context");
    expect(positive.plan!.management!.profile).toBe(EXIT_PROFILES[0].id);
    const negative = analyzeSymbol(qualifiedInput(), "1h", { model: model(-3) });
    expect(negative.action).toBe("WAIT");
    expect(negative.qualification!.find(check => check.id === "edge")!.passed).toBe(false);
  });
  it("keeps a horizon research-only while its trained model is not validated", () => {
    const setup = analyzeSymbol(qualifiedInput(), "1h", { model: model(3, false) });
    expect(setup.action).toBe("WAIT");
    expect(setup.qualification!.find(check => check.id === "edge")!.requiredFor).toBe("context");
    expect(setup.qualification!.find(check => check.id === "calibration")!.passed).toBe(false);
  });
});

describe("cx-spot-5 features, model and statistics", () => {
  it("computes bounded causal features", () => {
    const candles = series("1h");
    expect(adx(candles)).toBeGreaterThan(0);
    expect(adx(candles.slice(0, 20))).toBeNull();
    expect(percentileRank([1, 2, 3, 4], 3.5)).toBe(.75);
    expect(Math.abs(volumeZ(candles, "1h"))).toBeLessThanOrEqual(5);
  });
  it("fits a logistic model that ranks an informative feature", () => {
    let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = Array.from({ length: 400 }, () => [random() * 2 - 1, random()]);
    const labels = rows.map(([x]) => random() < 1 / (1 + Math.exp(-4 * x)) ? 1 : 0);
    const fitted = trainLogistic(rows, labels);
    expect(fitted.weights[0]).toBeGreaterThan(1);
    expect(auc(rows.map(row => predictProbability(fitted, row)), labels)!).toBeGreaterThan(.75);
    expect(auc([1, 2, 3], [0, 0, 1])).toBe(1);
  });
  it("produces deterministic bootstrap and Monte Carlo statistics", () => {
    const values = Array.from({ length: 50 }, (_, i) => i % 3 === 0 ? -1 : 1.2);
    expect(bootstrapMean(values)).toEqual(bootstrapMean(values));
    expect(bootstrapMean(values)![0]).toBeGreaterThan(0);
    expect(monteCarloDrawdown(values)!).toBeGreaterThan(0);
    expect(bootstrapMean([1, 2])).toBeNull();
    const trades = values.map((r, i) => ({ id: `${i}`, publishedAt: "2026-01-01T00:00:00.000Z", enteredAt: "2026-01-01T00:00:00.000Z", exitAt: "2026-01-01T01:00:00.000Z", entryFill: 1, exitFill: 1, quantity: 1, pnl: r, returnPct: r, status: r > 0 ? "CLOSED" : "STOPPED", rMultiple: r, scaled: r > 0 }));
    const summary = summarizeHorizon("1h", trades);
    expect(summary.validated).toBe(false);
    expect(summary.exitReasons).toEqual({ stopped: 17, trail: 33, target: 0, time: 0 });
    expect(summary.histogram.reduce((s, bin) => s + bin.count, 0)).toBe(50);
  });
});

describe("cx-spot-5 bundled model", () => {
  it("matches the feature contract and ends before its replay window", () => {
    expect(BUNDLED_MODEL.featureVersion).toBe(FEATURE_VERSION);
    expect(Date.parse(BUNDLED_MODEL.trainedThrough!)).toBeGreaterThan(Date.parse(BUNDLED_MODEL.trainedFrom!));
    for (const horizon of Object.values(BUNDLED_MODEL.horizons)) {
      expect(horizon.weights).toHaveLength(FEATURE_KEYS.length);
      expect(EXIT_PROFILES.map(p => p.id)).toContain(horizon.exitProfile);
    }
  });
});

describe("cx-spot-5 training", () => {
  it("validates only a model that improves a purged chronological holdout", () => {
    let seed = 11; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base = managedSetup();
    const make = (informative: boolean): Candidate[] => Array.from({ length: 600 }, (_, i) => {
      const features = FEATURE_KEYS.map(() => random() * 2 - 1);
      const win = informative ? random() < (features[0] > 0 ? .75 : .2) : random() < .4;
      const r = win ? 1.4 : -1;
      return { symbol: "BTCUSDT", timeframe: "1h", publishedAt: Date.UTC(2025, 0, 1) + i * 6 * 3_600_000, setup: { ...base, timeframe: "1h", holdingPeriodHours: 72 }, features, ruleBuy: random() < .3,
        outcomes: Object.fromEntries([...EXIT_PROFILES.map(p => p.id), "legacy"].map(id => [id, r])) };
    });
    const good = fitHorizon(make(true), "1h");
    expect(good.model!.validated).toBe(true);
    expect(good.model!.validation.selectedMeanR!).toBeGreaterThan(good.model!.validation.allMeanR);
    const noise = fitHorizon(make(false), "1h");
    expect(noise.model?.validated ?? false).toBe(false);
  });
  it("never labels a candidate with data past the training boundary", () => {
    const setup = { ...managedSetup(), timeframe: "1h" as const, holdingPeriodHours: 72 };
    const source = { symbol: "BTCUSDT", baseAsset: "BTC", tickSize: .01, stepSize: .001, minNotional: 5, candles: { "15m": [], "1h": [bar(2, 101, 102, 99.5, 101)], "4h": [], "1d": [] } };
    expect(simulateOutcome(setup, Date.parse("2026-01-01T01:01:00Z"), source, DEFAULT_EXIT_PROFILE, Date.parse("2026-01-02T00:00:00Z"))).toBeUndefined();
  });
});
