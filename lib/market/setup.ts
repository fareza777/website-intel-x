import type { Candle, MarketSetup, QualificationCheck, Regime, Timeframe } from "../types";
import { INTERVAL_MS, MarketDataError, validateCandles } from "./binance";
import { computeIndicators } from "./indicators";
import { assessTradePlan, MAX_SETUP_RISK_PCT, MIN_SETUP_RISK_PCT } from "./risk";
import { confirmedPivots, detectStructure } from "./structure";
import { volumeIntelligence } from "./volume";

export const STRATEGY_VERSION = "cx-spot-2";
export const MIN_QUOTE_VOLUME = 5_000_000;
const TIMEFRAMES: Timeframe[] = ["1h", "4h", "1d"];
const HORIZONS: Record<Timeframe, { expiresHours: number; holdingHours: number; higher: Timeframe[];
  trends: [Timeframe, number, number][]; momentum: [Timeframe, number][] }> = {
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
  candles: Record<Timeframe, Candle[]>;
}

/** A deterministic long-spot rule agreement score; it has no probability interpretation. */
export function analyzeSymbol(input: SetupInput, timeframe: Timeframe = "1h"): MarketSetup {
  if (![input.now, input.change24h, input.quoteVolume24h].every(Number.isFinite)) throw new MarketDataError("Invalid setup timestamp or ticker statistics");
  const horizon = HORIZONS[timeframe];
  if (!horizon) throw new MarketDataError("Unsupported setup decision timeframe");
  const label = timeframe.toUpperCase();
  const closedBase = input.candles[timeframe].filter((candle) => candle.closeTime < input.now);
  validateCandles(closedBase, timeframe);
  if (!closedBase.length) throw new MarketDataError(`No closed ${timeframe} decision candles are available`);
  const latest = closedBase[closedBase.length - 1];
  // ALL context, including lower frames shown in the UI, stops at this decision close.
  const candles = Object.fromEntries(TIMEFRAMES.map((interval) => [interval,
    input.candles[interval].filter((candle) => candle.closeTime <= latest.closeTime)])) as Record<Timeframe, Candle[]>;
  for (const interval of TIMEFRAMES) {
    validateCandles(candles[interval], interval);
    if (candles[interval].length < 200) throw new MarketDataError(`Insufficient closed ${interval} history for EMA200`);
  }
  const indicators = { "1h": computeIndicators(candles["1h"]), "4h": computeIndicators(candles["4h"]), "1d": computeIndicators(candles["1d"]) };
  const baseCandles = candles[timeframe];
  const base = indicators[timeframe];
  const structure = detectStructure(baseCandles);
  const volume = volumeIntelligence(baseCandles);
  // Structure event confirmation times and Candle.closeTime are both Unix milliseconds.
  const recent = structure.filter((event) => event.time >= latest.closeTime - 2 * INTERVAL_MS[timeframe]);
  const breakout = latest.close > Math.max(...baseCandles.slice(-21, -1).map((candle) => candle.high));
  const structureConfirmation = recent.some((event) => event.direction === "bullish" && ["BOS", "CHoCH", "SWEEP", "FALSE BREAKOUT"].includes(event.type));
  const currentConfirmation = latest.close > latest.open && (breakout || structureConfirmation);
  const aboveVwap = latest.close > volume.vwap;
  const higherAgreement = horizon.higher.every((interval) => indicators[interval].trend === "bullish");
  const bearishContext = horizon.trends.some(([interval]) => indicators[interval].trend === "bearish");
  // Lower frames deliberately lag now after a daily as-of cut; they do not gate daily freshness.
  const staleIntervals = [timeframe, ...horizon.higher].filter((interval) => {
    const reference = interval === timeframe ? input.now : latest.closeTime;
    return reference - candles[interval][candles[interval].length - 1].closeTime > 2 * INTERVAL_MS[interval];
  });
  const atrPct = base.atr / latest.close * 100;
  const extremeVolatility = atrPct > 6;
  const illiquid = input.quoteVolume24h < MIN_QUOTE_VOLUME || volume.relativeVolume < 0.3;
  const extended = base.rsi > 78 || latest.close - base.ema21 > base.atr * 3;
  const regime: Regime = extremeVolatility ? "HIGH VOLATILITY" : bearishContext ? "BEARISH"
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
  const assessment = assessTradePlan({ price: latest.close, atr: base.atr, support, tickSize: input.tickSize, stepSize: input.stepSize, minNotional: input.minNotional });
  const candidatePlan = assessment.plan;
  const positiveMomentum = horizon.momentum.every(([interval]) => indicators[interval].macdHistogram > 0);
  const riskDetail = assessment.riskPct === null ? "No valid positive, tick-rounded entry/stop/target configuration."
    : candidatePlan ? `Planned loss ${assessment.riskPct.toFixed(2)}% includes fees/slippage; accepted range ${MIN_SETUP_RISK_PCT}–${MAX_SETUP_RISK_PCT}%.`
      : assessment.reason === "risk_too_high" ? `Required stop risk ${assessment.riskPct.toFixed(2)}% exceeds ${MAX_SETUP_RISK_PCT}% after fees/slippage. Setup rejected at the published risk limit.`
        : assessment.reason === "risk_too_low" ? `Required stop risk ${assessment.riskPct.toFixed(2)}% is below ${MIN_SETUP_RISK_PCT}%.`
          : "Exchange tick rounding cannot produce distinct, correctly ordered targets.";
  const trendStates = horizon.trends.map(([tf]) => `${tf.toUpperCase()} ${indicators[tf].trend}`).join(" / ");
  const qualification: QualificationCheck[] = [
    { id: "freshness", label: "Fresh closed candles", requiredFor: "plan", passed: !staleIntervals.length, detail: staleIntervals.length ? `Stale context: ${staleIntervals.join(", ")}.` : "Relevant closed-candle contexts are within their freshness limits." },
    { id: "liquidity", label: "Liquidity floor", requiredFor: "plan", passed: !illiquid, detail: `24h quote volume ${(input.quoteVolume24h / 1e6).toFixed(2)}M USDT (minimum 5M); relative volume ${volume.relativeVolume.toFixed(2)}× (minimum 0.30×).` },
    { id: "trend_safety", label: "No bearish required trend", requiredFor: "plan", passed: !bearishContext, detail: trendStates },
    { id: "volatility", label: "Volatility limit", requiredFor: "plan", passed: !extremeVolatility, detail: `${label} ATR ${atrPct.toFixed(2)}% versus maximum 6%.` },
    { id: "extension", label: "No overextension", requiredFor: "plan", passed: !extended, detail: `${label} RSI ${base.rsi.toFixed(1)} (maximum 78); distance above EMA21 ${((latest.close - base.ema21) / base.atr).toFixed(2)} ATR (maximum 3).` },
    { id: "risk", label: "Valid cost-adjusted risk plan", requiredFor: "plan", passed: !!candidatePlan, detail: riskDetail },
    { id: "alignment", label: "Bullish EMA agreement", requiredFor: "buy", passed: higherAgreement && base.trend === "bullish", detail: trendStates },
    { id: "structure", label: "Fresh price confirmation", requiredFor: "buy", passed: currentConfirmation, detail: currentConfirmation ? `Bullish ${label} closed-candle structure or breakout confirmation is present.` : `Await a bullish ${label} candle with a recent confirmed structure break, sweep recovery or 20-bar breakout.` },
    { id: "vwap", label: "Above session VWAP", requiredFor: "buy", passed: aboveVwap, detail: aboveVwap ? "Decision close is above the observed session VWAP." : "Decision close has not reclaimed the observed session VWAP." },
    { id: "rsi", label: "Entry RSI range", requiredFor: "buy", passed: base.rsi >= 45 && base.rsi <= 70, detail: `${label} RSI ${base.rsi.toFixed(1)}; BUY requires 45–70.` },
    { id: "momentum", label: "Positive MACD momentum", requiredFor: "buy", passed: positiveMomentum, detail: horizon.momentum.map(([tf]) => `${tf.toUpperCase()} ${indicators[tf].macdHistogram > 0 ? "positive" : "not positive"}`).join(" / ") },
    { id: "participation", label: "Volume confirmation", requiredFor: "buy", passed: volume.relativeVolume >= 1.1 && volume.buyPressure >= .52, detail: `${label} relative volume ${volume.relativeVolume.toFixed(2)}× (requires 1.10×); taker-buy share ${(volume.buyPressure * 100).toFixed(2)}% (requires 52%).` },
    { id: "score", label: "Technical score floor", requiredFor: "buy", passed: score >= 78, detail: `${score}/100 versus minimum 78; a passing score cannot override another failed check.` },
  ];
  const rejected = qualification.some(check => check.requiredFor === "plan" && !check.passed);
  const ready = !rejected && qualification.every(check => check.passed);
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
  if (extremeVolatility) reasons.push(`Rejected extreme ${label} volatility above 6% ATR.`);
  if (extended) reasons.push(`Rejected overextended ${label} price or RSI; wait for a measured pullback.`);
  if (!candidatePlan) reasons.push(`No valid structure/ATR plan. ${riskDetail}`);
  if (action === "WAIT") reasons.push(`Conditional ${label} plan: wait for relevant EMA trend alignment, a fresh bullish ${label} closed-candle structure confirmation, positive required MACD momentum, and sufficient ${label} taker-buy volume before entry.`);
  if (action === "BUY") reasons.push(`${label} trend context, current bullish confirmation, momentum and actual taker-buy volume agree; the entry remains a conditional spot limit plan.`);
  if (action === "NO TRADE" && !rejected) reasons.push("Rule agreement is too weak to publish a trade plan.");
  const trendLabel = horizon.trends.map(([interval]) => interval.toUpperCase()).join(" and ");
  const momentumLabel = horizon.momentum.map(([interval]) => interval.toUpperCase()).join(" and ");
  const confirmations = [
    higherAgreement && base.trend === "bullish" ? `${trendLabel} EMA trends agree bullish` : `Await ${trendLabel} bullish EMA agreement`,
    currentConfirmation ? (breakout ? `Closed above the prior 20 ${label} highs` : `Recent bullish structure confirmation on a closed ${label} candle`) : `Await a fresh bullish ${label} BOS, CHoCH, sweep recovery or 20-bar breakout`,
    positiveMomentum ? `${momentumLabel} MACD histograms are positive` : `Await positive ${momentumLabel} MACD momentum`,
    volume.relativeVolume >= 1.1 && volume.buyPressure >= 0.52 ? `${label} volume and actual taker-buy share confirm demand` : `Await ${label} relative volume ≥1.1× and actual taker-buy share ≥52%`,
  ];
  const invalidations = [
    ...(plan ? [`Stop ${plan.stopLoss} is a fixed simulated exit level; a gap can cause a larger realized loss.`] : []),
    `A new bearish closed ${trendLabel} EMA trend requires reassessment and prevents new ${label} long qualification. Published simulation entry, stop and targets stay fixed; trend changes do not trigger an automatic exit.`,
    `Unfilled ${label} recommendations expire ${horizon.expiresHours} hours after their decision candle; maximum simulated hold after entry is ${horizon.holdingHours} hours. Reassess after any data gap or exchange outage.`,
  ];
  return { qualification, tickSize: input.tickSize, timeframe, holdingPeriodHours: horizon.holdingHours, id: `${input.symbol}-${timeframe}-${latest.closeTime}-${STRATEGY_VERSION}`, symbol: input.symbol, baseAsset: input.baseAsset, name: NAMES[input.baseAsset] ?? input.baseAsset,
    price: latest.close, change24h: input.change24h, quoteVolume24h: input.quoteVolume24h, score, action, regime,
    asOf: new Date(latest.closeTime).toISOString(), expiresAt: new Date(latest.closeTime + horizon.expiresHours * INTERVAL_MS["1h"]).toISOString(), plan, indicators, reasons, confirmations, invalidations,
    structure: structure.slice(-16), volume, sparkline: baseCandles.slice(-48).map((candle) => candle.close) };
}
