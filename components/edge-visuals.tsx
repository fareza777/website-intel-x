"use client";
import { Activity, BrainCircuit, Gauge, ShieldAlert, ShieldCheck } from "lucide-react";
import type { MarketSetup, Timeframe, TradePlan } from "@/lib/types";
import type { HorizonSummary, ScannerValidationReport } from "@/lib/research/types";
import type { ModelSummary } from "@/lib/market/model";
import { MODEL_SUMMARY } from "@/lib/market/model-summary";
import { cn, price } from "@/lib/utils";

const signed = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

/** Calibrated probability and expected R, or an explicit statement that none is validated. */
export function EdgeCard({ setup }: { setup: MarketSetup }) {
  const edge = setup.edge;
  const multiplier = setup.sizing?.riskMultiplier ?? 1;
  if (!edge) return <div className="edge-card untrained"><BrainCircuit size={20} /><div><strong>No calibrated model for {(setup.timeframe ?? "1h").toUpperCase()}</strong><p>Qualification uses the rule score. Setup quality is not a win probability.</p></div></div>;
  const pct = Math.round(edge.probability * 100);
  return <div className={cn("edge-card", edge.validated ? "validated" : "experimental")}>
    <div className="edge-gauge" style={{ ["--edge" as string]: `${pct}%` }} role="img" aria-label={`Estimated win probability ${pct}%`}><strong>{pct}%</strong><span>win est.</span></div>
    <div className="edge-copy">
      <div className="edge-title"><strong>{signed(edge.expectedR)}R</strong><span>expected per trade after costs</span></div>
      <p>{edge.validated ? <><ShieldCheck size={14} /> Model passed its out-of-sample holdout · minimum {edge.minimumEdgeR.toFixed(2)}R</> : <><ShieldAlert size={14} /> Model not validated · informational only</>}</p>
      {multiplier < 1 && <p className="edge-sizing"><Gauge size={14} /> Size ×{multiplier.toFixed(2)}: {setup.sizing!.reasons.join(" ")}</p>}
    </div>
  </div>;
}

/** Price ladder from stop to TP3, positioned to scale, with the costed breakeven marked. */
export function RiskLadder({ plan }: { plan: TradePlan }) {
  const low = plan.stopLoss, high = plan.targets[2].price, span = high - low || 1;
  const at = (value: number) => `${Math.max(0, Math.min(100, (value - low) / span * 100))}%`;
  const marks = [
    { label: "SL", value: plan.stopLoss, r: "−1R", tone: "negative" },
    { label: "Entry", value: plan.entry, r: "0R", tone: "entry" },
    ...plan.targets.map((target, i) => ({ label: `TP${i + 1}`, value: target.price, r: `${target.rr.toFixed(1)}R`, tone: "positive" })),
  ];
  return <div className="risk-ladder" aria-label="Risk ladder from stop loss to final target">
    <div className="ladder-track"><span className="ladder-loss" style={{ width: at(plan.entry) }} /><span className="ladder-gain" style={{ left: at(plan.entry) }} />
      {plan.management && <i className="ladder-breakeven" style={{ left: at(plan.management.breakevenStop) }} title={`Breakeven stop ${price(plan.management.breakevenStop)}`} />}
      {marks.map(mark => <b key={mark.label} className={cn("ladder-mark", mark.tone)} style={{ left: at(mark.value) }} />)}</div>
    <div className="ladder-labels">{marks.map(mark => <span key={mark.label} className={mark.tone}><strong>{mark.label}</strong><small>{mark.r}</small></span>)}</div>
    {plan.management && <p className="ladder-note">Sell {plan.management.partialFraction * 100}% at TP1 → stop to breakeven {price(plan.management.breakevenStop)} → trail {plan.management.trailMultiple}× ATR under the highest high until TP3 or time exit.</p>}
  </div>;
}

/** BTC tone and participation for the active horizon. */
export function RegimeBanner({ setups, timeframe }: { setups: MarketSetup[]; timeframe: Timeframe }) {
  const market = setups.find(setup => setup.market)?.market;
  if (!market) return null;
  const breadth = market.breadth === null ? null : Math.round(market.breadth * 100);
  return <div className={cn("regime-banner", market.riskOff ? "risk-off" : market.btcTrend === "bullish" ? "risk-on" : "neutral")}>
    <Activity size={18} />
    <div><span>MARKET REGIME · {timeframe.toUpperCase()}</span><strong>{market.riskOff ? "Risk-off: new BUY plans paused" : market.btcTrend === "bullish" ? "Supportive" : "Mixed"}</strong></div>
    <div><span>BTC TREND</span><strong className={market.btcTrend === "bullish" ? "positive" : market.btcTrend === "bearish" ? "negative" : "muted"}>{market.btcTrend}</strong></div>
    <div className="regime-breadth"><span>BREADTH</span>{breadth === null ? <strong className="muted">—</strong> : <><div className="breadth-track"><i style={{ width: `${breadth}%` }} /></div><strong>{breadth}%</strong></>}</div>
  </div>;
}

/** Action dots for every horizon of one market. */
export function HorizonDots({ symbol, timeframes }: { symbol: string; timeframes?: Partial<Record<Timeframe, MarketSetup[]>> }) {
  const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
  return <div className="horizon-dots">{frames.map(frame => {
    const action = timeframes?.[frame]?.find(setup => setup.symbol === symbol)?.action;
    return <span key={frame} className={cn(action === "BUY" ? "buy" : action === "WAIT" ? "wait" : action ? "no-trade" : "missing")} title={`${frame.toUpperCase()}: ${action ?? "unavailable"}`}>{frame.toUpperCase()}</span>;
  })}</div>;
}

export function EdgeCell({ setup }: { setup: MarketSetup }) {
  if (!setup.edge) return <span className="muted">—</span>;
  return <span className={cn("edge-cell", !setup.edge.validated && "unvalidated")} title={setup.edge.validated ? "Validated calibrated estimate" : "Unvalidated model estimate"}>
    <b className={setup.edge.expectedR > 0 ? "positive" : "negative"}>{signed(setup.edge.expectedR)}R</b><small>{Math.round(setup.edge.probability * 100)}%</small></span>;
}

/** Pooled per-horizon replay summaries: expectancy with confidence interval, exits and R distribution. */
export function HorizonSummaries({ report }: { report: ScannerValidationReport }) {
  if (!report.summaries?.length) return null;
  return <div className="horizon-summaries">
    {report.model && <p className={cn("model-status", report.model.outOfSample ? "ok" : "warn")}>{report.model.outOfSample ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
      Model {report.model.version}{report.model.trainedThrough ? ` trained through ${new Date(report.model.trainedThrough).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}` : ""}. {report.model.outOfSample ? "This replay window is out-of-sample for the model." : "This replay overlaps the model's training data; treat it as in-sample."}</p>}
    <div className="summary-grid">{report.summaries.map(summary => <SummaryCard key={summary.timeframe} summary={summary} />)}</div>
    <Heatmap report={report} />
  </div>;
}

function SummaryCard({ summary }: { summary: HorizonSummary }) {
  const exits = summary.exitReasons, total = exits.stopped + exits.trail + exits.target + exits.time || 1;
  const maxBin = Math.max(1, ...summary.histogram.map(bin => bin.count));
  return <article className={cn("summary-card", summary.validated ? "validated" : summary.expectancyR !== null && summary.expectancyR < 0 ? "negative-card" : "")}>
    <header><strong>{summary.timeframe.toUpperCase()}</strong><span>{summary.validated ? "Statistically positive" : summary.trades < 100 ? "Limited sample" : "Not proven"}</span></header>
    <div className="summary-metrics">
      <div><span>Trades</span><b>{summary.trades}</b></div>
      <div><span>Win rate</span><b>{summary.winRate === null ? "—" : `${summary.winRate.toFixed(1)}%`}</b></div>
      <div><span>Profit factor</span><b>{summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}</b></div>
      <div><span>Expectancy</span><b className={summary.expectancyR !== null && summary.expectancyR < 0 ? "negative" : "positive"}>{summary.expectancyR === null ? "—" : `${signed(summary.expectancyR)}R`}</b></div>
    </div>
    {summary.ciLowR !== null && summary.ciHighR !== null && <CiBar low={summary.ciLowR} high={summary.ciHighR} mean={summary.expectancyR ?? 0} />}
    <div className="exit-bar" role="img" aria-label={`Exits: ${exits.stopped} stopped, ${exits.trail} protected/trailed, ${exits.target} final target, ${exits.time} time`}>
      <i className="stopped" style={{ width: `${exits.stopped / total * 100}%` }} /><i className="trail" style={{ width: `${exits.trail / total * 100}%` }} /><i className="target" style={{ width: `${exits.target / total * 100}%` }} /><i className="time" style={{ width: `${exits.time / total * 100}%` }} /></div>
    <div className="exit-legend"><span className="stopped">Stop {exits.stopped}</span><span className="trail">Trail {exits.trail}</span><span className="target">TP3 {exits.target}</span><span className="time">Time {exits.time}</span></div>
    <div className="r-histogram" aria-label="Distribution of trade outcomes in R">{summary.histogram.map((bin, i) => <div key={i} title={`${bin.low ?? "−∞"}R to ${bin.high ?? "∞"}R: ${bin.count}`}><i className={(bin.high ?? 1) <= 0 ? "loss" : "gain"} style={{ height: `${bin.count / maxBin * 100}%` }} /></div>)}</div>
    <div className="r-axis"><span>≤−1.5R</span><span>0R</span><span>≥3R</span></div>
    {summary.drawdownR95 !== null && <p className="summary-note">95% Monte Carlo drawdown: {summary.drawdownR95.toFixed(1)}R across reshuffled trade orders.</p>}
  </article>;
}

function CiBar({ low, high, mean }: { low: number; high: number; mean: number }) {
  const min = Math.min(-1, low), max = Math.max(1, high), at = (value: number) => `${(value - min) / (max - min) * 100}%`;
  return <div className="ci-bar" title={`90% bootstrap interval ${signed(low)}R to ${signed(high)}R`}><span>90% interval</span>
    <div><i className="zero" style={{ left: at(0) }} /><i className={cn("range", low > 0 ? "positive" : high < 0 ? "negative" : "")} style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} /><i className="mean" style={{ left: at(mean) }} /></div>
    <small>{signed(low)}R … {signed(high)}R</small></div>;
}

function Heatmap({ report }: { report: ScannerValidationReport }) {
  const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
  const symbols = [...new Set(report.rows.map(row => row.symbol))];
  const cell = (symbol: string, frame: Timeframe) => {
    const row = report.rows.find(item => item.symbol === symbol && item.timeframe === frame);
    const trades = row?.trades ?? [];
    const r = trades.length ? trades.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / trades.length : null;
    return { r, n: trades.length };
  };
  return <div className="heatmap-wrap"><h3>Expectancy by market and horizon (R per trade)</h3><div className="table-scroll"><table className="heatmap"><thead><tr><th>Market</th>{frames.map(frame => <th key={frame}>{frame.toUpperCase()}</th>)}</tr></thead><tbody>
    {symbols.map(symbol => <tr key={symbol}><td>{symbol.replace("USDT", "")}</td>{frames.map(frame => {
      const { r, n } = cell(symbol, frame);
      const intensity = r === null ? 0 : Math.min(1, Math.abs(r) / 1);
      return <td key={frame} className={r === null ? "empty" : r >= 0 ? "gain" : "loss"} style={{ ["--heat" as string]: intensity.toFixed(2) }} title={`${n} trades`}>{r === null ? "—" : signed(r)}<small>{n}</small></td>;
    })}</tr>)}
  </tbody></table></div><p className="summary-note">Cells with few trades are noisy; read them with the per-horizon interval above.</p></div>;
}

/** Holdout reliability of the bundled model: predicted versus observed win rate. */
export function ModelCalibration({ model = MODEL_SUMMARY }: { model?: ModelSummary }) {
  const horizons = Object.entries(model.horizons) as [Timeframe, NonNullable<ModelSummary["horizons"][Timeframe]>][];
  return <section className="panel model-panel">
    <div className="panel-heading"><div><h2>Calibrated edge model</h2><p>{model.version === "untrained" ? "No model has been trained yet; qualification uses rule scores." : `${model.version} · trained ${model.trainedFrom ? new Date(model.trainedFrom).toLocaleDateString("en-US") : "—"} – ${model.trainedThrough ? new Date(model.trainedThrough).toLocaleDateString("en-US") : "—"} on ${model.universe.length} markets`}</p></div><BrainCircuit size={22} /></div>
    {horizons.length > 0 && <div className="model-grid">{horizons.map(([frame, horizon]) => {
      const v = horizon.validation;
      return <article key={frame} className={cn("model-card", horizon.validated ? "validated" : "")}>
        <header><strong>{frame.toUpperCase()}</strong><span>{horizon.validated ? "Validated" : "Not validated"}</span></header>
        <svg viewBox="0 0 120 120" className="reliability" role="img" aria-label={`${frame} predicted versus observed win rate`}>
          <path d="M10 110 L110 10" className="diagonal" /><path d="M10 110 H110 M10 110 V10" className="axis" />
          {v.calibration.map((bin, i) => <circle key={i} cx={10 + bin.predicted * 100} cy={110 - bin.observed * 100} r={Math.max(2.5, Math.min(6, bin.count / 20))} />)}
        </svg>
        <dl><div><dt>Holdout AUC</dt><dd>{v.auc === null ? "—" : v.auc.toFixed(3)}</dd></div><div><dt>Base win rate</dt><dd>{(v.baseWinRate * 100).toFixed(1)}%</dd></div>
          <div><dt>Selected</dt><dd>{v.selected} · {v.selectedMeanR === null ? "—" : `${signed(v.selectedMeanR)}R`}</dd></div><div><dt>All candidates</dt><dd>{signed(v.allMeanR)}R</dd></div>
          <div><dt>Exit profile</dt><dd>{horizon.exitProfile}</dd></div><div><dt>Min edge</dt><dd>{horizon.minimumEdgeR.toFixed(2)}R</dd></div></dl>
        <p>{horizon.reason}</p>
      </article>;
    })}</div>}
    <p className="summary-note">{model.notes.join(" ")}</p>
  </section>;
}
