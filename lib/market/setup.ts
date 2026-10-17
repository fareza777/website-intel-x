import type { Candle, ContextTimeframe, MarketSetup, PositionSizing, QualificationCheck, Regime, Timeframe } from "../types";
import { INTERVAL_MS, MarketDataError, validateCandles } from "./binance";
import { computeIndicators } from "./indicators";
import { assessTradePlan, MIN_SETUP_RISK_PCT } from "./risk";
import { confirmedPivots, detectStructure } from "./structure";
import { volumeIntelligence } from "./volume";
import { entrySignal } from "./entry";
import { exitProfile, QUALIFICATION_POLICIES, SIZING, STRATEGY_VERSION } from "./policy";
import { summarizeContext, type MarketContext } from "./context";
import { computeFeatures } from "./features";
import { derivativeFeatures } from "./derivatives";
import { estimateEdge } from "./model";
import { BUNDLED_MODEL } from "./bundled-model";

export { STRATEGY_VERSION } from "./policy";
export const MIN_QUOTE_VOLUME = 5_000_000;
const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d"];
const HORIZONS: Record<Timeframe, { expiresHours: number; holdingHours: number; higher: Timeframe[];
  trends: [Timeframe, number, number][]; momentum: [Timeframe, number][] }> = {
  "15m": { expiresHours: 6, holdingHours: 18, higher: ["4h", "1h"],
    trends: [["4h", 20, 5], ["1h", 20, 5], ["15m", 15, 5]], momentum: [["15m", 5], ["1h", 5]] },
  "1h": { expiresHours: 24, holdingHours: 72, higher: ["1d", "4h"],
    trends: [["1d", 20, 5], ["4h", 20, 5], ["1h", 15, 5]], momentum: [["1h", 5], ["4h", 5]] },
  "4h": { expiresHours: 72, holdingHours: 216, higher: ["1d"],
    trends: [["1d", 20, 5], ["4h", 35, 10]], momentum: [["4h", 5], ["1d", 5]] },
  "1d": { expiresHours: 168, holdingHours: 720, higher: [],
    trends: [["1d", 55, 15]], momentum: [["1d", 10]] },
};
const NAMES: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche", LINK: "Chainlink", DOT: "Polkadot", LTC: "Litecoin", BCH: "Bitcoin Cash", TRX: "TRON", SUI: "Sui", TON: "Toncoin", NEAR: "NEAR Protocol", UNI: "Uniswap", AAVE: "Aave", SHIB: "Shiba Inu", ARB: "Arbitrum", OP: "Optimism", ATOM: "Cosmos", FIL: "Filecoin", ICP: "Internet Computer", ETC: "Ethereum Classic", XLM: "Stellar", HBAR: "Hedera", INJ: "Injective", RENDER: "Render", POL: "Polygon", TAO: "Bittensor", PEPE: "Pepe" };

export interface SetupInput {
  symbol: string;
  baseAsset: string;
  change24h: number;
  quoteVolume24h: number;
  tickSize: number;
  stepSize: number;
  minNotional: number;
  now: number;
  candles: Record<ContextTimeframe, Candle[]> & Partial<Record<"15m", Candle[]>>;
}

/** A deterministic long-spot rule agreement score; it has no probability interpretation. */
export function analyzeSymbol(input: SetupInput, timeframe: Timeframe = "1h", context?: MarketContext): MarketSetup {
  if (![input.now, input.change24h, input.quoteVolume24h].every(Number.isFinite)) throw new MarketDataError("Invalid setup timestamp or ticker statistics");
  const horizon = HORIZONS[timeframe];
  if (!horizon) throw new MarketDataError("Unsupported setup decision timeframe");
  const policy = QUALIFICATION_POLICIES[timeframe];
  const label = timeframe.toUpperCase();
  const closedBase = (input.candles[timeframe] ?? []).filter((candle) => candle.closeTime < input.now);
  validateCandles(closedBase, timeframe);
  if (!closedBase.length) throw new MarketDataError(`No closed ${timeframe} decision candles are available`);
  const latest = closedBase[closedBase.length - 1];
  // ALL context, including lower frames shown in the UI, stops at this decision close.
  const frames: Timeframe[] = timeframe === "15m" ? ["15m", ...TIMEFRAMES] : TIMEFRAMES;
  const candles = Object.fromEntries(frames.map((interval) => [interval,
    (input.candles[interval] ?? []).filter((candle) => candle.closeTime <= latest.closeTime)])) as Record<Timeframe, Candle[]>;
  for (const interval of frames) {
    validateCandles(candles[interval], interval);
    if (candles[interval].length < 200) throw new MarketDataError(`Insufficient closed ${interval} history for EMA200`);
  }
  const indicators = Object.fromEntries(frames.map(interval => [interval, computeIndicators(candles[interval])])) as Record<Timeframe, ReturnType<typeof computeIndicators>>;
  const baseCandles = candles[timeframe];
  const base = indicators[timeframe];
  const structure = detectStructure(baseCandles);
  const volume = volumeIntelligence(baseCandles);
  // Structure event confirmation times and Candle.closeTime are both Unix milliseconds.
  const entryModel = entrySignal(baseCandles, base.atr, volume.relativeVolume, structure);
  const currentConfirmation = entryModel !== undefined;
  const aboveVwap = latest.close > volume.vwap;
  const higherAgreement = horizon.higher.every((interval) => indicators[interval].trend !== "bearish");
  const decisionTrend = latest.close > base.ema50 && base.ema50 > base.ema200;
  const bearishContext = horizon.trends.some(([interval]) => indicators[interval].trend === "bearish");
  // Lower frames deliberately lag now after a daily as-of cut; they do not gate daily freshness.
  const staleIntervals = [timeframe, ...horizon.higher].filter((interval) => {
    const reference = interval === timeframe ? input.now : latest.closeTime;
    return reference - candles[interval][candles[interval].length - 1].closeTime > 2 * INTERVAL_MS[interval];
  });
  const atrPct = base.atr / latest.close * 100;
  const extremeVolatility = atrPct > policy.maximumAtrPct;
  const illiquid = input.quoteVolume24h < MIN_QUOTE_VOLUME || volume.relativeVolume < 0.3;
  const extended = base.rsi > 78 || latest.close - base.ema21 > base.atr * 3;
  const market = summarizeContext(context, timeframe, latest.closeTime);
  const model = context?.model === undefined ? BUNDLED_MODEL : context.model;
  const horizonModel = model?.horizons[timeframe];
  const exit = exitProfile(horizonModel?.exitProfile);
  const regime: Regime = extremeVolatility ? "HIGH VOLATILITY" : bearishContext || market.summary.riskOff ? "BEARISH"
    : higherAgreement && base.trend === "bullish" ? "BULLISH" : "SIDEWAYS";

  // Every horizon allocates 55 points to its relevant EMA trends and 10 to MACD.
  // 1D never awards the same daily MACD twice or borrows intraday quality points.
  let score = horizon.trends.reduce((total, [interval, bullish, neutral]) => total
    + (indicators[interval].trend === "bullish" ? bullish : indicators[interval].trend === "neutral" ? neutral : 0), 0);
  score += horizon.momentum.reduce((total, [interval, weight]) => total + (indicators[interval].macdHistogram > 0 ? weight : 0), 0);
  score += base.rsi >= 45 && base.rsi <= 68 ? 10 : base.rsi >= 35 && base.rsi <= 72 ? 5 : 0;
  score += volume.relativeVolume >= 1.15 ? 8 : volume.relativeVolume >= 0.8 ? 4 : 0;
  score += volume.buyPressure >= 0.52 ? 5 : volume.buyPressure >= 0.48 ? 2 : 0;
  score += aboveVwap ? 5 : 0;
  score += currentConfirmation ? 7 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const pivots = confirmedPivots(baseCandles);
  const support = pivots.filter((pivot) => pivot.kind === "low" && pivot.index >= baseCandles.length - 40 && pivot.price < latest.close).at(-1)?.price
    ?? Math.min(...baseCandles.slice(-12).map((candle) => candle.low));
  const assessment = assessTradePlan({ price: latest.close, atr: base.atr, support, tickSize: input.tickSize, stepSize: input.stepSize, minNotional: input.minNotional, maxRiskPct: policy.maximumStopRiskPct, exit });
  const candidatePlan = assessment.plan;
  const positiveMomentum = horizon.momentum.every(([interval]) => indicators[interval].macdHistogram > 0);
  const riskDetail = assessment.riskPct === null ? "No valid positive, tick-rounded entry/stop/target configuration."
    : candidatePlan ? `Planned loss ${assessment.riskPct.toFixed(2)}% includes fees/slippage; accepted ${label} range ${MIN_SETUP_RISK_PCT}–${policy.maximumStopRiskPct}%. Account risk is controlled by quantity.`
      : assessment.reason === "risk_too_high" ? `Required stop risk ${assessment.riskPct.toFixed(2)}% exceeds ${policy.maximumStopRiskPct}% for ${label} after fees/slippage. Setup rejected at the published risk limit.`
        : assessment.reason === "risk_too_low" ? `Required stop risk ${assessment.riskPct.toFixed(2)}% is below ${MIN_SETUP_RISK_PCT}%.`
          : "Exchange tick rounding cannot produce distinct, correctly ordered targets.";
  const features = computeFeatures({ timeframe, candles: baseCandles, indicators: base, score, entryModel, buyPressure: volume.buyPressure, aboveVwap,
    stopRiskPct: assessment.riskPct, maximumStopRiskPct: policy.maximumStopRiskPct, btc: input.symbol === "BTCUSDT" ? baseCandles : market.btc, btcTrend: market.summary.btcTrend, breadth: market.summary.breadth,
    derivatives: context?.derivatives ? derivativeFeatures(context.derivatives[input.symbol], latest.closeTime) : undefined });
  const edge = estimateEdge(model, timeframe, features);
  const calibrated = edge?.validated === true;
  const edgePassed = edge !== null && edge.expectedR >= edge.minimumEdgeR;
  const edgeDetail = edge === null ? "No trained model is available for this horizon; the rule-based score floor applies."
    : `Calibrated win probability ${(edge.probability * 100).toFixed(1)}%; expected ${edge.expectedR >= 0 ? "+" : ""}${edge.expectedR.toFixed(2)}R after costs versus minimum ${edge.minimumEdgeR.toFixed(2)}R. ${calibrated ? "Model passed its chronological holdout checks and qualifies entries." : "Model did not pass its holdout checks; shown for information only."}`;
  const experimental = timeframe === "15m";
  const sizingReasons: string[] = [];
  let riskMultiplier = 1;
  if (features.atrPercentile >= SIZING.highVolatilityPercentile) { riskMultiplier *= SIZING.highVolatilityMultiplier; sizingReasons.push(`ATR is in the top ${Math.round((1 - SIZING.highVolatilityPercentile) * 100)}% of its recent range: half size.`); }
  if (input.symbol !== "BTCUSDT" && features.beta >= SIZING.highBeta) { riskMultiplier *= SIZING.highBetaMultiplier; sizingReasons.push(`High BTC beta ${features.beta.toFixed(2)}: three-quarter size.`); }
  if (experimental) { riskMultiplier *= SIZING.experimentalMultiplier; sizingReasons.push("15M is the noisiest horizon: half size."); }
  const sizing: PositionSizing = { riskMultiplier: Math.max(SIZING.minimum, riskMultiplier), reasons: sizingReasons.length ? sizingReasons : ["Full chosen account-risk budget."] };
  const trendStates = horizon.trends.map(([tf]) => `${tf.toUpperCase()} ${indicators[tf].trend}`).join(" / ");
  const qualification: QualificationCheck[] = [
    { id: "freshness", label: "Fresh closed candles", requiredFor: "plan", passed: !staleIntervals.length, detail: staleIntervals.length ? `Stale context: ${staleIntervals.join(", ")}.` : "Relevant closed-candle contexts are within their freshness limits." },
    { id: "liquidity", label: "Liquidity floor", requiredFor: "plan", passed: !illiquid, detail: `24h quote volume ${(input.quoteVolume24h / 1e6).toFixed(2)}M USDT (minimum 5M); relative volume ${volume.relativeVolume.toFixed(2)}× (minimum 0.30×).` },
    { id: "trend_safety", label: "No bearish required trend", requiredFor: "plan", passed: !bearishContext, detail: trendStates },
    { id: "volatility", label: "Volatility limit", requiredFor: "plan", passed: !extremeVolatility, detail: `${label} ATR ${atrPct.toFixed(2)}% versus horizon maximum ${policy.maximumAtrPct}%.` },
    { id: "extension", label: "No overextension", requiredFor: "plan", passed: !extended, detail: `${label} RSI ${base.rsi.toFixed(1)} (maximum 78); distance above EMA21 ${((latest.close - base.ema21) / base.atr).toFixed(2)} ATR (maximum 3).` },
    { id: "risk", label: "Valid cost-adjusted risk plan", requiredFor: "plan", passed: !!candidatePlan, detail: riskDetail },
    { id: "alignment", label: "Uptrend suitable for a spot long", requiredFor: "buy", passed: higherAgreement && decisionTrend, detail: `${label} close must exceed EMA50 and EMA50 must exceed EMA200; higher context must not be bearish. ${trendStates}` },
    { id: "structure", label: "Specific closed-candle entry trigger", requiredFor: "buy", passed: currentConfirmation, detail: entryModel ? `${label} ${entryModel}: a confirmed price trigger is present.` : `Await a bullish breakout/structure reclaim with volume ≥1×, or a controlled EMA21 pullback and bullish recovery.` },
    { id: "vwap", label: "Above session VWAP", requiredFor: "context", passed: aboveVwap, detail: aboveVwap ? "Supporting context: decision close is above VWAP." : "Supporting context: close is below VWAP. This alone does not veto a valid entry." },
    { id: "rsi", label: "Preferred RSI range", requiredFor: "context", passed: base.rsi >= 45 && base.rsi <= 70, detail: `${label} RSI ${base.rsi.toFixed(1)}; 45–70 is preferred context, not a separate entry veto. The >78 extension limit remains mandatory.` },
    { id: "momentum", label: "Positive MACD momentum", requiredFor: "context", passed: positiveMomentum, detail: horizon.momentum.map(([tf]) => `${tf.toUpperCase()} ${indicators[tf].macdHistogram > 0 ? "positive" : "not positive"}`).join(" / ") },
    { id: "participation", label: "Volume and taker-buy support", requiredFor: "context", passed: volume.relativeVolume >= 1.1 && volume.buyPressure >= .52, detail: `${label} relative volume ${volume.relativeVolume.toFixed(2)}×; taker-buy ${(volume.buyPressure * 100).toFixed(2)}%. Preferred 1.10× / 52% adds context. Breakouts require 1× volume; pullbacks may use normal/lower volume.` },
    { id: "regime", label: "Market regime not risk-off", requiredFor: "buy", passed: !market.summary.riskOff, detail: market.summary.detail },
    ...(edge ? [{ id: "edge", label: "Positive calibrated edge", requiredFor: calibrated ? "buy" as const : "context" as const, passed: edgePassed, detail: edgeDetail }] : []),
    { id: "score", label: "Technical score floor", requiredFor: calibrated ? "context" : "buy", passed: score >= policy.minimumBuyScore, detail: `${score}/100 versus minimum ${policy.minimumBuyScore}; ${calibrated ? "the calibrated edge replaces this floor while its model is validated." : "score cannot override safety or a missing price trigger."}` },
    // No edge, no trade: once a horizon has a trained model, only a validated one may publish BUY.
    ...(!calibrated && (experimental || horizonModel) ? [{ id: "calibration", label: `Validated ${label} model`, requiredFor: "buy" as const, passed: false,
      detail: horizonModel ? `The ${label} model did not pass its out-of-sample holdout (training candidates averaged ${horizonModel.validation.allMeanR >= 0 ? "+" : ""}${horizonModel.validation.allMeanR.toFixed(2)}R; holdout AUC ${horizonModel.validation.auc?.toFixed(2) ?? "—"}). ${label} stays research-only until a retrained model validates.`
        : "15M lost money in the cx-spot-4 replay. New 15M BUY plans require a model that passed its chronological holdout; until then 15M stays research-only." }] : []),
  ];
  const rejected = qualification.some(check => check.requiredFor === "plan" && !check.passed);
  const ready = !rejected && qualification.every(check => check.requiredFor === "context" || check.passed);
  const action = ready ? "BUY" : !rejected && score >= 50 ? "WAIT" : "NO TRADE";
  const plan = action === "NO TRADE" ? null : candidatePlan;
  const reasons: string[] = [
    `${label} score ${score}/100 measures deterministic rule agreement, not probability of profit.`,
    `${label} decision uses closed ${horizon.trends.map(([interval]) => `${interval.toUpperCase()} ${indicators[interval].trend}`).join(" / ")} EMA trends; ${label} RSI ${base.rsi.toFixed(1)}, ATR ${atrPct.toFixed(2)}%. All displayed context closes by this decision candle.`,
    `Relative ${label} volume ${volume.relativeVolume.toFixed(2)}× versus the previous 20 ${label} bars; actual 24-bar ${label} taker-buy base-volume share ${(volume.buyPressure * 100).toFixed(1)}%.`,
    `UTC-session VWAP uses reported quote/base volume totals from ${label} bars. The last 48-bar ${label} candle volume profile and POC are approximate: volume is spread uniformly across each candle's high-low range, not measured from trade-level volume at price.`,
    "Order blocks, liquidity sweeps and FVGs are causal price-action heuristics, not proof of institutional orders or future fills. Pivots require two right-side closed candles before use.",
  ];
  if (staleIntervals.length) reasons.push(`Rejected stale closed-candle data: ${staleIntervals.join(", ")} exceeded twice its interval.`);
  if (illiquid) reasons.push(`Rejected low liquidity: require at least 5M USDT in reported 24-hour quote volume and non-depleted ${label} volume.`);
  if (bearishContext) reasons.push(`Rejected bearish ${label} decision or required higher timeframe: this strategy researches long spot positions only.`);
  if (extremeVolatility) reasons.push(`Rejected extreme ${label} volatility above ${policy.maximumAtrPct}% ATR.`);
  if (extended) reasons.push(`Rejected overextended ${label} price or RSI; wait for a measured pullback.`);
  if (!candidatePlan) reasons.push(`No valid structure/ATR plan. ${riskDetail}`);
  if (action === "WAIT") reasons.push(`Conditional ${label} plan: await a valid decision uptrend, a specific breakout/reclaim or EMA21 pullback trigger, and score ≥${policy.minimumBuyScore}. MACD, RSI preference, VWAP and taker-buy are supporting context, not individual vetoes.`);
  if (edge) reasons.push(edgeDetail);
  if (market.summary.riskOff) reasons.push(`Risk-off market: ${market.summary.detail}`);
  if (action === "BUY") reasons.push(`${label} ${entryModel} qualifies with the decision uptrend, score floor and all safety checks. Entry remains a conditional spot limit plan; supporting indicators need not all agree.`);
  if (action === "NO TRADE" && !rejected) reasons.push("Rule agreement is too weak to publish a trade plan.");
  const trendLabel = horizon.trends.map(([interval]) => interval.toUpperCase()).join(" and ");
  const momentumLabel = horizon.momentum.map(([interval]) => interval.toUpperCase()).join(" and ");
  const confirmations = [
    higherAgreement && decisionTrend ? `${label} close > EMA50 > EMA200; required higher trends are not bearish` : `Await a valid ${label} uptrend and non-bearish higher context`,
    entryModel === "BREAKOUT" ? `Closed above the prior 20 ${label} highs with relative volume ≥1×` : entryModel === "STRUCTURE_RECLAIM" ? `Recent bullish structure confirmation on the decision ${label} candle with relative volume ≥1×` : entryModel === "PULLBACK" ? `Bullish ${label} EMA21 pullback recovery above the previous close` : `Await a confirmed ${label} breakout/reclaim or EMA21 pullback recovery`,
    `Supporting context: ${momentumLabel} MACD ${positiveMomentum ? "positive" : "not all positive"}; contributes score, not an individual veto`,
    `Supporting context: ${label} relative volume ${volume.relativeVolume.toFixed(2)}×, taker-buy ${(volume.buyPressure * 100).toFixed(2)}%; no fixed taker-buy entry veto`,
  ];
  const invalidations = [
    ...(plan ? [`Stop ${plan.stopLoss} is a fixed simulated exit level; a gap can cause a larger realized loss.`] : []),
    ...(plan?.management ? [`Exit plan: sell ${plan.management.partialFraction * 100}% at TP1 ${plan.targets[0].price}, then move the remaining stop to breakeven ${plan.management.breakevenStop} and trail it ${plan.management.trailMultiple}× ATR (${plan.management.atr.toPrecision(4)}) below the highest high. TP3 ${plan.targets[2].price} closes the remainder.`] : []),
    `A new bearish closed ${trendLabel} EMA trend requires reassessment and prevents new ${label} long qualification. Published simulation entry, stop and targets stay fixed; trend changes do not trigger an automatic exit.`,
    `Unfilled ${label} recommendations expire ${horizon.expiresHours} hours after their decision candle; maximum simulated hold after entry is ${horizon.holdingHours} hours. Reassess after any data gap or exchange outage.`,
  ];
  return { strategyVersion: STRATEGY_VERSION, entryModel, policy: { ...policy }, features, edge, market: market.summary, sizing, experimental, riskReview: assessment.review, qualification, tickSize: input.tickSize, timeframe, holdingPeriodHours: horizon.holdingHours, id: `${input.symbol}-${timeframe}-${latest.closeTime}-${STRATEGY_VERSION}`, symbol: input.symbol, baseAsset: input.baseAsset, name: NAMES[input.baseAsset] ?? input.baseAsset,
    price: latest.close, change24h: input.change24h, quoteVolume24h: input.quoteVolume24h, score, action, regime,
    asOf: new Date(latest.closeTime).toISOString(), expiresAt: new Date(latest.closeTime + horizon.expiresHours * INTERVAL_MS["1h"]).toISOString(), plan, indicators, reasons, confirmations, invalidations,
    structure: structure.slice(-16), volume, sparkline: baseCandles.slice(-48).map((candle) => candle.close) };
}
