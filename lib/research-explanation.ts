import type { MarketSetup, QualificationCheck, Timeframe } from "./types";

export function riskLesson(positionLossPct: number, capital: number, accountRiskPct: number) {
  if (![positionLossPct, capital, accountRiskPct].every(Number.isFinite) || positionLossPct <= 0 || positionLossPct >= 100 || capital <= 0 || accountRiskPct <= 0 || accountRiskPct > 5) return null;
  const accountBudget = capital * accountRiskPct / 100;
  return { accountBudget, lossOn100: positionLossPct, approximateDebit: Math.min(capital, accountBudget / (positionLossPct / 100)) };
}
export function positionLoss(setup: MarketSetup): number | null {
  const loss = setup.riskReview?.costedLossPct ?? setup.plan?.riskPct;
  if (loss != null && Number.isFinite(loss)) return loss;
  const text = setup.qualification?.find(check => check.id === "risk")?.detail ?? setup.reasons?.join(" ") ?? "";
  const match = /(?:stop risk|Planned loss)\s+(\d+(?:\.\d+)?)%/i.exec(text);
  return match ? Number(match[1]) : null;
}
const labels: Record<string, [string, string]> = {
  freshness: ["Complete data at scan time", "Analysis uses closed candles, with freshness limits for each timeframe."],
  liquidity: ["Sufficient market liquidity", "Daily volume must be large enough, and the latest candle's volume must not be too low."],
  trend_safety: ["Supporting trends are not bearish", "The spot-long strategy avoids downtrends on confirmation timeframes."],
  volatility: ["Volatility within limits", "ATR measures the average price range. Excessive ATR makes planned entries and stops harder to sustain."],
  extension: ["Price is not overextended", "Price far above its EMA or an elevated RSI increases the risk of a correction before entry."],
  risk: ["Stop loss within plan limits", "The stop sits below support and at least 1.5 ATR from entry. The loss calculation includes fees and slippage."],
  alignment: ["Primary and supporting trends are bullish", "Price must be above EMA21, EMA21 above EMA50, and EMA50 above EMA200 on the required timeframes."],
  structure: ["Recent price confirmation", "Requires a bullish candle breaking the previous 20-candle high or confirmed bullish structure."],
  vwap: ["Price above session VWAP", "The close must be above the volume-weighted average price of the observed UTC session."],
  rsi: ["RSI within the entry range", "The BUY RSI range is 45–70. This is a strategy parameter, not a guarantee of price direction."],
  momentum: ["Positive MACD momentum", "The MACD histogram must be positive on the decision and required confirmation timeframes."],
  participation: ["Supporting volume and buying", "Relative volume must be at least 1.1× the previous average, with taker-buy share of at least 52% over the strategy window."],
  score: ["Sufficient technical agreement", "The score measures rule alignment. BUY still requires all safety and confirmation checks."],
  regime: ["Market is not risk-off", "New long plans pause when BTC's higher-timeframe trend is bearish and fewer than 30% of scanned markets close above their EMA50."],
  edge: ["Positive calibrated edge", "A model trained only on earlier data estimates the win probability and expected R after costs. It qualifies entries only after passing an out-of-sample holdout."],
  calibration: ["Validated model for this horizon", "No edge, no trade: a horizon whose trained model failed its out-of-sample holdout (and 15M without any model) stays research-only and publishes no BUY plans."],
};
function decisionFrames(timeframe: Timeframe): Timeframe[] { return timeframe === "15m" ? ["15m", "1h", "4h"] : timeframe === "1h" ? ["1h", "4h", "1d"] : timeframe === "4h" ? ["4h", "1d"] : ["1d"]; }
export function explainCheck(check: QualificationCheck, setup: MarketSetup) {
  const timeframe = setup.timeframe ?? "1h", base = setup.indicators?.[timeframe];
  let [label, meaning] = labels[check.id] ?? [check.label, check.detail];
  if (setup.policy) {
    if (check.id === "alignment") { label = "Bullish trend for spot long"; meaning = "Close must be above EMA50 and EMA50 above EMA200. Higher-timeframe context may be neutral, but not bearish. EMA21 alignment contributes to the score rather than acting as a separate veto."; }
    if (check.id === "structure") { label = "Confirmed entry trigger"; meaning = "One path is enough: a breakout or structure confirmation on the decision candle with volume ≥1×, or an EMA21 bounce after a pullback with a close above the previous close. Both use closed candles."; }
    if (check.requiredFor === "context") {
      meaning = `${check.id === "rsi" ? "RSI 45–70 is preferred. RSI >78 is still rejected by the overextension rule." : check.id === "participation" ? "Relative volume and taker-buy add quality. Entry does not require taker-buy ≥52%; breakouts still need volume ≥1×, while pullbacks may use normal or low volume." : check.id === "momentum" ? "Positive MACD on the relevant timeframes supports momentum and adds to the score. A valid price trigger may still qualify before MACD turns positive." : check.id === "vwap" ? "A close above VWAP supports price relative to the session average. A close below reduces the score without invalidating a price trigger on its own." : labels[check.id]?.[1] ?? check.detail} This supporting indicator does not veto entry on its own.`;
      if (check.id === "rsi") label = "RSI within the preferred range";
    }
  }
  let measured = "";
  if (["trend_safety", "alignment"].includes(check.id)) measured = decisionFrames(timeframe).map(tf => `${tf.toUpperCase()} ${setup.indicators?.[tf]?.trend === "bullish" ? "bullish" : setup.indicators?.[tf]?.trend === "bearish" ? "bearish" : "neutral"}`).join(" · ");
  if (check.id === "risk") measured = positionLoss(setup) === null ? "Valid stop or target levels have not formed." : `Estimated position loss ${positionLoss(setup)!.toFixed(2)}% · policy limit ${setup.riskReview?.maximumLossPct ?? 8}%.`;
  if (check.id === "rsi" && base) measured = `${timeframe.toUpperCase()} RSI ${base.rsi.toFixed(1)} · ${check.requiredFor === "context" ? "preferred range" : "BUY range"} 45–70.`;
  if (check.id === "volatility" && base) measured = `${timeframe.toUpperCase()} ATR ${(base.atr / setup.price * 100).toFixed(2)}% of price · policy limit ${setup.policy?.maximumAtrPct ?? 6}%.`;
  if (check.id === "extension" && base) measured = `RSI ${base.rsi.toFixed(1)} · distance from EMA21 ${base.atr > 0 ? ((setup.price - base.ema21) / base.atr).toFixed(2) : "—"} ATR.`;
  if (check.id === "score") measured = `${setup.score}/100 · WAIT minimum 50; ${check.requiredFor === "context" ? "the validated edge replaces the 78 floor." : "base BUY threshold 78."}`;
  if (check.id === "edge" && setup.edge) measured = `Win estimate ${(setup.edge.probability * 100).toFixed(1)}% · expected ${setup.edge.expectedR.toFixed(2)}R · minimum ${setup.edge.minimumEdgeR.toFixed(2)}R.`;
  if (check.id === "regime" && setup.market) measured = `BTC ${setup.market.btcTrend} · breadth ${setup.market.breadth === null ? "unavailable" : `${Math.round(setup.market.breadth * 100)}%`}.`;
  if (check.id === "liquidity") measured = `24h volume ${(setup.quoteVolume24h / 1e6).toFixed(2)} million USDT · minimum 5 million.`;
  if (check.id === "participation" && setup.volume) measured = `Relative volume ${setup.volume.relativeVolume.toFixed(2)}× · taker-buy ${(setup.volume.buyPressure * 100).toFixed(1)}%.`;
  if (check.id === "freshness") measured = `Decision candle ${new Date(setup.asOf).toLocaleString("en-US")}. Check status is frozen at scan time.`;
  if (check.id === "structure" && setup.policy) measured = setup.entryModel === "BREAKOUT" ? "Breakout above the previous 20-candle high." : setup.entryModel === "STRUCTURE_RECLAIM" ? "Bullish structure confirmed on the decision candle." : setup.entryModel === "PULLBACK" ? "Confirmed pullback and EMA21 recovery." : "No qualifying price trigger on the decision candle.";
  return { label, meaning, measured };
}
export function explainDecision(setup: MarketSetup) {
  const blocked = setup.qualification?.filter(c => c.requiredFor === "plan" && !c.passed) ?? [];
  const risk = blocked.find(c => c.id === "risk");
  const loss = positionLoss(setup);
  if (setup.action === "NO TRADE" && risk && loss !== null && loss > (setup.riskReview?.maximumLossPct ?? 8)) return {
    title: "Stop loss exceeds the strategy limit",
    summary: `If the stop is reached, estimated loss is ${loss.toFixed(2)}% of position value, including costs. The ${setup.riskReview?.maximumLossPct ?? 8}% limit is the app's policy for this plan. Position size separately determines the risk to account capital.`,
  };
  if (setup.action === "NO TRADE" && blocked.length) {
    const first = explainCheck(blocked[0], setup); return { title: first.label + " — unmet", summary: [first.meaning, first.measured].filter(Boolean).join(" ") };
  }
  if (setup.action === "NO TRADE" && setup.score < 50) return { title: "Insufficient indicator agreement", summary: `The ${setup.score}/100 score is below the plan qualification threshold. WAIT requires at least 50 and passed safety checks. This score measures rule alignment, not win probability.` };
  if (setup.action === "NO TRADE") return { title: "Plan does not meet strategy requirements", summary: "This publication failed safety or plan qualification rules. Legacy records do not include a structured checklist; their original reasons remain in the setup details. A high score does not replace those checks." };
  if (setup.action === "WAIT") {
    const missing = setup.qualification?.filter(c => !c.passed && c.requiredFor === "buy").slice(0, 2).map(c => explainCheck(c, setup).label) ?? [];
    return { title: "Watch for complete confirmation", summary: missing.length ? `Unmet requirements: ${missing.join("; ")}. WAIT plans cannot yet be taken as paper trades.` : "Wait for trend, momentum, structure and volume to meet all BUY rules in a new scan." };
  }
  if (setup.policy) return { title: `${setup.entryModel === "PULLBACK" ? "EMA21 pullback" : setup.entryModel === "STRUCTURE_RECLAIM" ? "Structure reclaim" : "Confirmed breakout"} · ready for paper trading`, summary: "All required checks passed; supporting indicators need not be perfect. Take the plan to start recording the simulation. A fill still needs the entry price, and position size is limited by the account risk budget after costs." };
  return { title: "Setup met the rules at scan time", summary: "Entry still waits for the listed limit price. Stop, targets and position size use the data, costs and risk budget; the trade outcome still needs evaluation." };
}
