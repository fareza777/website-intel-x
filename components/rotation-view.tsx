"use client";
import { CircleOff, Orbit, ShieldAlert, TrendingUp } from "lucide-react";
import type { RotationBacktest, RotationSignal } from "@/lib/market/rotation";
import { MODEL_SUMMARY } from "@/lib/market/model-summary";
import { cn, percent } from "@/lib/utils";
import { CoinIcon } from "./research-panel";

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export function RotationView({ signal, outOfSample }: { signal?: RotationSignal; outOfSample?: RotationBacktest | null }) {
  const train = MODEL_SUMMARY.rotation?.train;
  if (!signal) return <section className="panel"><div className="empty-state large"><Orbit size={38} /><h2>Rotation is waiting for its first scan.</h2><p>The next scheduled publication ranks the universe from closed daily candles.</p></div></section>;
  const next = new Date(Date.parse(signal.asOf) + signal.params.rebalanceDays * 86_400_000);
  return <div className="view-stack rotation-view">
    <section className={cn("rotation-hero", signal.regimeOn ? "on" : "off")}>
      <div className="rotation-hero-copy">
        <span className="eyebrow-chip">{signal.regimeOn ? <TrendingUp size={15} /> : <CircleOff size={15} />}{signal.regimeOn ? "REGIME ON · INVESTED" : "REGIME OFF · CASH"}</span>
        <h2>{signal.regimeOn ? `Holding the ${signal.picks.length} strongest trends.` : "Standing aside until BTC recovers."}</h2>
        <p>BTC daily close {signal.btcClose?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"} versus its {signal.params.regimeSma}-day average {signal.btcSma?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}. Ranked by {signal.params.lookbackDays}-day risk-adjusted momentum, rebalanced every {signal.params.rebalanceDays} days.</p>
        <div className="rotation-meta"><span>Signal close<b>{date(signal.asOf)}</b></span><span>Next rebalance<b>{date(next.toISOString())}</b></span><span>Holdings<b>{signal.params.holdings} max</b></span></div>
      </div>
      <Allocation signal={signal} />
    </section>
    <section className="panel rotation-ranking">
      <div className="panel-heading"><div><h2>Momentum leaderboard</h2><p>Positive momentum above the 50-day average, ranked by return per unit of volatility.</p></div></div>
      {signal.ranked.length ? <div className="leaderboard">{signal.ranked.map((pick, i) => {
        const held = signal.picks.find(item => item.symbol === pick.symbol);
        const max = signal.ranked[0].score || 1;
        return <div key={pick.symbol} className={cn("leader-row", held && "held")}>
          <span className="leader-rank">{i + 1}</span>
          <CoinIcon asset={pick.symbol.replace(/USDT$/, "")} small />
          <strong>{pick.symbol.replace(/USDT$/, "")}<small>{held ? `${(held.weight * 100).toFixed(0)}% weight` : "watch"}</small></strong>
          <div className="leader-bar"><i style={{ width: `${Math.max(4, pick.score / max * 100)}%` }} /></div>
          <span className="leader-stat positive">{percent(pick.momentumPct)}</span>
          <span className="leader-stat muted">σ {pick.volatilityPct.toFixed(2)}%</span>
        </div>;
      })}</div> : <p className="panel-note">No market currently has positive momentum above its 50-day average.</p>}
    </section>
    <section className="panel rotation-evidence">
      <div className="panel-heading"><div><h2>Backtest evidence</h2><p>Parameters chosen on the training window; the replay window was never used to choose them. 15 bps per side on turnover.</p></div></div>
      <div className="rotation-tests">
        {train && <BacktestCard title="Training window" result={train} />}
        {outOfSample ? <BacktestCard title="Out-of-sample" result={outOfSample} highlight /> : <p className="panel-note">The out-of-sample replay appears after the daily evidence run.</p>}
      </div>
      <p className="summary-note"><ShieldAlert size={14} /> Momentum persistence is documented in crypto research, but it can reverse sharply. A short out-of-sample window is not proof of future returns.</p>
    </section>
  </div>;
}

function Allocation({ signal }: { signal: RotationSignal }) {
  const radius = 62, circumference = 2 * Math.PI * radius;
  const starts = signal.picks.map((_, i) => signal.picks.slice(0, i).reduce((sum, pick) => sum + pick.weight * circumference, 0));
  return <div className="allocation">
    <svg viewBox="0 0 160 160" role="img" aria-label={signal.picks.length ? `Allocation: ${signal.picks.map(p => `${p.symbol} ${(p.weight * 100).toFixed(0)}%`).join(", ")}` : "Allocation: 100% cash"}>
      <circle cx="80" cy="80" r={radius} className="allocation-track" />
      {signal.picks.map((pick, i) => <circle key={pick.symbol} cx="80" cy="80" r={radius} stroke={PALETTE[i % PALETTE.length]} strokeDasharray={`${Math.max(0, pick.weight * circumference - 3)} ${circumference}`} strokeDashoffset={-starts[i]} className="allocation-slice" />)}
      <text x="80" y="76" textAnchor="middle" className="allocation-value">{signal.picks.length ? signal.picks.length : "0"}</text>
      <text x="80" y="98" textAnchor="middle" className="allocation-label">{signal.picks.length ? "HOLDINGS" : "CASH"}</text>
    </svg>
    <ul>{signal.picks.length ? signal.picks.map((pick, i) => <li key={pick.symbol}><i style={{ background: PALETTE[i % PALETTE.length] }} />{pick.symbol.replace(/USDT$/, "")}<b>{(pick.weight * 100).toFixed(1)}%</b></li>) : <li><i className="cash" />USDT<b>100%</b></li>}</ul>
  </div>;
}

function BacktestCard({ title, result, highlight = false }: { title: string; result: RotationBacktest; highlight?: boolean }) {
  const values = result.equity.flatMap(point => [point.value, point.btc]), low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const line = (key: "value" | "btc") => result.equity.map((point, i) => `${(i / Math.max(1, result.equity.length - 1) * 600).toFixed(1)},${(150 - (point[key] - low) / span * 130).toFixed(1)}`).join(" ");
  return <article className={cn("backtest-card", highlight && "highlight")}>
    <header><strong>{title}</strong><span>{date(result.start)} — {date(result.end)}</span></header>
    <div className="backtest-metrics">
      <div><span>Strategy</span><b className={result.totalReturnPct >= 0 ? "positive" : "negative"}>{percent(result.totalReturnPct)}</b></div>
      <div><span>BTC hold</span><b className={result.btcReturnPct >= 0 ? "positive" : "negative"}>{percent(result.btcReturnPct)}</b></div>
      <div><span>Max drawdown</span><b>{result.maxDrawdownPct.toFixed(1)}%</b></div>
      <div><span>Sharpe</span><b>{result.sharpe === null ? "—" : result.sharpe.toFixed(2)}</b></div>
      <div><span>Invested</span><b>{result.exposurePct.toFixed(0)}%</b></div>
    </div>
    {result.equity.length > 1 && <svg viewBox="0 0 600 160" className="backtest-chart" role="img" aria-label={`${title} equity versus BTC`}>
      <defs><linearGradient id={`fill-${title.replace(/\W/g, "")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity=".35" /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,160 ${line("value")} 600,160`} fill={`url(#fill-${title.replace(/\W/g, "")})`} />
      <polyline points={line("btc")} className="btc-line" />
      <polyline points={line("value")} className="strategy-line" />
    </svg>}
    <div className="chart-key"><span className="strategy">Rotation</span><span className="btc">BTC buy &amp; hold</span></div>
  </article>;
}
