"use client";
import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, CircleCheck, Clock3, Copy, Info, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { cn, dollars, money, percent, price } from "@/lib/utils";
import { positionSize } from "@/lib/market/risk";
import type { MarketSetup, Timeframe } from "@/lib/types";
import { QualificationSummary } from "./market-eligibility";
import { EdgeCard, RiskLadder } from "./edge-visuals";

export function ActionBadge({ action }: { action: string }) { return <span className={cn("action-badge", action === "BUY" ? "buy" : action === "WAIT" ? "wait" : "no-trade")}>{action === "BUY" ? <ArrowUpRight size={13} /> : action === "WAIT" ? <Clock3 size={13} /> : <span className="badge-dot" />}{action === "BUY" ? "BUY SETUP" : action}</span>; }
export function CoinIcon({ asset, small = false }: { asset: string; small?: boolean }) {
  const glyphs: Record<string, string> = { BTC: "₿", ETH: "Ξ", SOL: "≋", BNB: "◇", XRP: "×", ADA: "₳", DOGE: "Ð", AVAX: "Λ", LINK: "⬡", SUI: "S" };
  return <span className={cn("coin-icon", `coin-${asset.toLowerCase()}`, small && "coin-small")}>{glyphs[asset] || asset.slice(0, 1)}</span>;
}
export function ResearchPanel({ setup, capital, risk, onCapital, onRisk, onSimulate, notify, onGuide, disabled = false, virtualPreview = null, virtualIssue }: { setup: MarketSetup; capital: number; risk: number; onCapital: (value: number) => void; onRisk: (value: number) => void; onSimulate: () => void; notify: (text: string) => void; onGuide?: () => void; disabled?: boolean; virtualPreview?: { quantity: number; reserved: number; maxLoss: number } | null; virtualIssue?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [sizing, setSizing] = useState(false);
  const plan = setup.plan;
  let size: ReturnType<typeof positionSize> | null = null;
  try { if (plan && capital >= 100 && capital <= 1e9 && risk >= .1 && risk <= 5) size = positionSize(plan, capital, risk * (setup.sizing?.riskMultiplier ?? 1)); } catch { /* Validated inputs show no size until valid. */ }
  async function copy() {
    if (!plan) return;
    try { await navigator.clipboard.writeText(`${setup.symbol} | ${setup.action} | score ${setup.score}/100 (not probability)\nEntry ${plan.entry} | zone ${plan.entryZone.join(" – ")}\nSL ${plan.stopLoss} | TP ${plan.targets.map(t => t.price).join(" / ")}\nExpires ${setup.expiresAt}\nSpot research only. Fees ${plan.feeBps}bps + slippage ${plan.slippageBps}bps per side.`); notify("Research plan copied."); }
    catch { notify("Clipboard access is unavailable in this browser."); }
  }
  return <section className="panel research-panel">
    <div className="panel-heading"><h2>Trade intelligence</h2><span className="micro-tag">{(setup.timeframe ?? "1h").toUpperCase()} · SPOT</span></div>
    <div className="research-identity"><div className="asset-pair"><CoinIcon asset={setup.baseAsset} /><div><strong>{setup.baseAsset}<span> / USDT</span></strong><span className="muted">{setup.name}</span></div></div><ActionBadge action={setup.action} /></div>
    <div className="quality-row"><span>Setup quality <Info size={14} aria-label="Rule agreement, not win probability" /></span><strong>{setup.score}<small> / 100</small></strong></div>
    <div className="quality-track"><span style={{ width: `${setup.score}%` }} /></div>
    <p className="score-note">Technical agreement. Not a win probability.</p>
    <EdgeCard setup={setup} />
    <QualificationSummary setup={setup} capital={capital} risk={risk} onGuide={onGuide} />
    {plan ? <>
      <div className="entry-block"><span>Recommended entry</span><div><strong>{dollars(plan.entry)}</strong><button className="icon-button" title="Copy research plan" aria-label="Copy research plan" onClick={copy}><Copy size={17} /></button></div><p>Zone <b>{price(plan.entryZone[0])} – {price(plan.entryZone[1])}</b></p></div>
      <div className="level-row stop"><span><i /> Stop loss</span><strong>{dollars(plan.stopLoss)}</strong><span title="Estimated net return after planned fees and slippage">−{plan.riskPct.toFixed(2)}%</span></div>
      <div className="target-levels">{plan.targets.map((target, i) => <div className="level-row" key={i}><span><i /> Take profit {i + 1}</span><strong>{dollars(target.price)}</strong><span title="Estimated net return after planned fees and slippage">+{target.gainPct.toFixed(2)}%</span></div>)}</div>
      <RiskLadder plan={plan} />
      <div className="risk-reward"><span>Net risk / reward</span><strong>1 : {plan.targets[1]?.rr.toFixed(2) || "—"}<small>at TP2</small></strong></div>
      <button className="sizing-toggle" aria-expanded={sizing} onClick={() => setSizing(!sizing)}><SlidersHorizontal size={16} /> Research sizing estimate <span>{+(risk * (setup.sizing?.riskMultiplier ?? 1)).toFixed(2)}% risk</span>{sizing ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      {sizing && <div className="sizing-fields"><label>Capital (USDT)<input type="number" min="100" max="1000000000" value={capital} onChange={e => onCapital(Number(e.target.value))} /></label><label>Risk (%)<input type="number" min="0.1" max="5" step="0.1" value={risk} onChange={e => onRisk(Number(e.target.value))} /></label><p>{size?.quantity ? `${price(size.quantity)} ${setup.baseAsset} · ${money(size.notional)} position · ${money(size.maxLoss)} planned loss including costs` : size ? "This balance and risk do not meet the exchange minimum order size." : "Enter valid capital and risk values."}</p><p>Virtual trade size uses your portfolio starting capital, available cash, and exchange lot rules.</p></div>}
      <Button className="simulate-button" disabled={disabled || setup.action !== "BUY" || !virtualPreview} onClick={onSimulate}><ShieldCheck />{setup.action === "BUY" ? "Take virtual trade" : "Waiting for confirmation"}<ArrowUpRight /></Button>
      {virtualPreview && <p className="execution-note">Virtual size: {price(virtualPreview.quantity)} {setup.baseAsset} · {money(virtualPreview.reserved)} cash reserved · {money(virtualPreview.maxLoss)} planned loss including costs.</p>}
      {setup.action === "BUY" && virtualIssue && <p className="execution-note" role="status">{virtualIssue}</p>}
      <p className="execution-note">Level returns include {plan.feeBps} bps fee + {plan.slippageBps} bps slippage / side. Virtual funds only.</p>
    </> : <div className="rejected-setup"><ShieldCheck size={28} /><strong>Protect your capital.</strong><p>This market does not meet the strategy’s entry requirements. No trade plan is published.</p></div>}
    <button className="reason-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>The reasoning behind this setup {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>
    {expanded && <div className="reason-content">{setup.reasons.map((reason, i) => <p key={i}><CircleCheck size={15} />{reason}</p>)}<h3>Entry requirements</h3>{setup.confirmations.map((text, i) => <p key={i}>{text}</p>)}<h3>Invalidation</h3>{setup.invalidations.map((text, i) => <p key={i}>{text}</p>)}<p><Clock3 size={15} />Expires {new Date(setup.expiresAt).toLocaleString("en-US", { timeZoneName: "short" })}</p></div>}
  </section>;
}
export function TimeframeAgreement({ setup }: { setup: MarketSetup }) {
  const frames: Timeframe[] = setup.timeframe === "15m" ? ["15m", "1h", "4h"] : ["1h", "4h", "1d"];
  return <div className="timeframe-agreement">{frames.map(tf => <div key={tf} className="min-w-0"><span>{tf.toUpperCase()} TREND</span><strong className={setup.indicators[tf]?.trend === "bullish" ? "positive" : setup.indicators[tf]?.trend === "bearish" ? "negative" : "muted"}>{setup.indicators[tf]?.trend ?? "unavailable"}{(setup.indicators[tf]?.trend === "bullish" || setup.indicators[tf]?.trend === "bearish") && <ArrowUpRight size={15} style={{ transform: setup.indicators[tf]?.trend === "bearish" ? "rotate(90deg)" : undefined }} />}</strong></div>)}</div>;
}
export function Change({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="muted">—</span>;
  return <span className={value > 0 ? "positive" : value < 0 ? "negative" : "muted"}>{percent(value)}</span>;
}
export function TechnicalContext({ setup, timeframe }: { setup: MarketSetup; timeframe: Timeframe }) {
  const indicator = setup.indicators[timeframe];
  if (!indicator) return <p className="panel-note">{timeframe.toUpperCase()} indicators are unavailable in this publication.</p>;
  return <div className="technical-context"><div><span>RESEARCH REGIME</span><strong className={setup.regime === "BEARISH" ? "negative" : setup.regime === "BULLISH" ? "positive" : "muted"}>{setup.regime.toLowerCase()}</strong></div><div><span>{timeframe.toUpperCase()} RSI · 14</span><strong>{indicator.rsi.toFixed(1)}<small> / 100</small></strong></div><div><span>{timeframe.toUpperCase()} MACD HISTOGRAM</span><strong className={indicator.macdHistogram > 0 ? "positive" : indicator.macdHistogram < 0 ? "negative" : "muted"}>{price(indicator.macdHistogram)}</strong></div><div><span>{timeframe.toUpperCase()} ATR · 14</span><strong>{dollars(indicator.atr)}</strong></div></div>;
}
