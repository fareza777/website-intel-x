"use client";
import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, BookOpen, Clock3, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import type { PaperAccount, PaperPosition } from "@/lib/paper";
import type { SpotQuote } from "@/lib/types";
import { dollars, money, percent, price, relativeTime } from "@/lib/utils";
import { downloadJson } from "@/lib/download";
import { Button } from "./ui/button";
import { CoinIcon } from "./research-panel";

interface Props { account: PaperAccount; quotes: Record<string, SpotQuote>; update: () => void; busy: boolean; importAccount: (value: string) => void; onJournal: (index: number, value: string) => void; onManage: (position: PaperPosition, kind: "cancel" | "close") => void; onExplore: () => void; onCapital: (value: number) => void }
function netPnl(position: PaperPosition): number {
  if (position.signal.entryFill === null || position.signal.exitFill === null) return 0;
  const fee = position.signal.setup.plan!.feeBps / 10_000;
  return position.quantity * (position.signal.exitFill * (1 - fee) - position.signal.entryFill * (1 + fee));
}
function currentMark(position: PaperPosition, quote?: SpotQuote) {
  if (!quote) return null;
  const age = Date.now() - Date.parse(quote.asOf);
  if (quote.symbol !== position.signal.setup.symbol || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isFinite(age) || age > 120_000 || age < -10_000) return null;
  const plan = position.signal.setup.plan!;
  return position.quantity * quote.price * (1 - plan.feeBps / 10_000) * (1 - plan.slippageBps / 10_000);
}
export function PaperView({ account, quotes, update, busy, importAccount, onJournal, onManage, onExplore, onCapital }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("active");
  const [horizon, setHorizon] = useState("all");
  const [capital, setCapital] = useState(String(account.initialCapital));
  const active = account.positions.filter(p => !p.settled);
  const closed = account.positions.filter(p => p.settled && p.signal.realizedReturnPct !== null);
  const realized = closed.reduce((sum, p) => sum + netPnl(p), 0);
  const wins = closed.filter(p => netPnl(p) > 0).length;
  let equity = account.cash, openPnl = 0, missingMarks = false;
  for (const p of active) {
    if (!p.signal.enteredAt) equity += p.reserved;
    else { const mark = currentMark(p, quotes[p.signal.setup.symbol]); if (mark === null) missingMarks = true; else { equity += mark; openPnl += mark - p.entryCost!; } }
  }
  const visible = account.positions.map((position, index) => ({ position, index })).filter(({ position: p }) => (tab === "all" || tab === "active" && !p.settled || tab === "history" && p.settled) && (horizon === "all" || (p.signal.setup.timeframe ?? "1h") === horizon));
  return <div className="view-stack portfolio-view">
    <div className="portfolio-intro"><div className="portfolio-identity"><span><Wallet size={25} /></span><div className="min-w-0"><div className="eyebrow">YOUR LOCAL RESEARCH ACCOUNT</div><h2>Put your research to the test.</h2><p>Real market data. Virtual capital. Every decision, accounted for.</p></div></div><Button onClick={onExplore}>Find a setup<ArrowRight /></Button></div>
    <div className="portfolio-status"><span><ShieldCheck size={16} />Saved on this device</span><span><RefreshCw size={15} />Live marks every 30 seconds</span><span><Clock3 size={15} />Closed-candle outcomes every minute while open</span></div>
    <div className="stat-grid portfolio-stats"><div className="stat-card accent-stat"><span>Virtual portfolio equity</span><strong>{missingMarks ? "—" : money(equity)}</strong><p>{missingMarks ? "A fresh mark is unavailable" : "After estimated liquidation costs"}</p></div><div className="stat-card"><span>Available virtual cash</span><strong>{money(account.cash)}</strong><p>{money(account.initialCapital)} starting balance</p></div><div className="stat-card"><span>Realized net P/L</span><strong className={realized < 0 ? "negative" : "positive"}>{money(realized)}</strong><p>{closed.length} completed virtual trades</p></div><div className="stat-card"><span>Unrealized net P/L</span><strong className={openPnl < 0 ? "negative" : "positive"}>{missingMarks ? "—" : money(openPnl)}</strong><p>Fresh public quotes, with exit costs</p></div><div className="stat-card"><span>Observed win rate</span><strong>{closed.length ? `${(wins / closed.length * 100).toFixed(1)}%` : "—"}</strong><p>{closed.length ? `${wins} profitable / ${closed.length} closed` : "No completed trades yet"}</p></div><div className="stat-card"><span>Active research plans</span><strong>{active.length}</strong><p>{active.filter(p => !p.signal.enteredAt).length} waiting · {active.filter(p => p.signal.enteredAt).length} filled</p></div></div>
    {!account.positions.length && <section className="initial-capital"><div><strong>Your capital. Your process.</strong><p>Choose the starting virtual balance before taking your first recommendation.</p></div><label>USDT<input aria-label="Starting virtual capital" type="number" min="100" max="1000000000" value={capital} onChange={e => setCapital(e.target.value)} /></label><Button variant="outline" onClick={() => onCapital(Number(capital))}>Set balance</Button></section>}
    <section className="panel"><div className="panel-heading"><div><h2>Realized balance curve</h2><p>Initial capital plus actual net outcomes of your completed virtual trades.</p></div><span className="micro-tag">YOUR TAKEN RECOMMENDATIONS</span></div><RealizedCurve positions={closed} initial={account.initialCapital} /></section>
    <section className="panel"><div className="panel-heading"><h2>My virtual trades</h2><div className="toolbar-actions"><Button variant="ghost" size="sm" onClick={() => input.current?.click()}><ArrowUpFromLine />Import</Button><Button variant="outline" size="sm" onClick={() => downloadJson("cryptointel-paper-portfolio.json", account)}><ArrowDownToLine />Export</Button><input ref={input} type="file" accept="application/json,.json" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) importAccount(await f.text()); e.target.value = ""; }} /></div></div>
      <div className="portfolio-filters"><div className="segment" aria-label="Virtual trade status filter">{[{ id: "active", label: "Active plans" }, { id: "history", label: "Trade history" }, { id: "all", label: "All records" }].map(item => <button key={item.id} aria-pressed={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><select aria-label="Virtual trade timeframe filter" value={horizon} onChange={e => setHorizon(e.target.value)}><option value="all">All timeframes</option><option value="15m">15M trades</option><option value="1h">1H trades</option><option value="4h">4H trades</option><option value="1d">1D trades</option></select><Button variant="outline" size="sm" onClick={update} disabled={busy}><RefreshCw className={busy ? "spin" : ""} />Reconcile</Button></div>
      {visible.length ? <div className="paper-positions">{visible.map(({ position: p, index }) => {
        const plan = p.signal.setup.plan!, quote = quotes[p.signal.setup.symbol];
        const mark = currentMark(p, quote);
        const pnl = p.settled ? p.signal.entryFill !== null ? netPnl(p) : null : p.entryCost !== null && mark !== null ? mark - p.entryCost : null;
        return <article className="paper-position" key={`${p.signal.setup.id}-${p.signal.publishedAt}`}><div className="paper-position-head"><div className="table-asset"><CoinIcon asset={p.signal.setup.baseAsset} /><div className="min-w-0"><strong>{p.signal.setup.baseAsset}<span>/ USDT</span><span className="trade-horizon">{(p.signal.setup.timeframe ?? "1h").toUpperCase()}</span></strong><small>{price(p.quantity)} units · taken {relativeTime(p.signal.publishedAt)}</small></div></div><span className="status-pill">{p.signal.status === "INVALIDATED" && p.signal.events.some(event => event.type === "USER CANCEL") ? "CANCELLED" : p.signal.status}</span><div className="position-result"><strong className={pnl !== null && pnl < 0 ? "negative" : pnl !== null && pnl > 0 ? "positive" : "muted"}>{money(pnl)}</strong><small>{p.settled ? percent(p.signal.realizedReturnPct) : p.signal.enteredAt ? "unrealized after costs" : "cash reserved"}</small></div></div>
          <div className="trade-detail-grid"><div><span>Original setup quality</span><strong>{p.signal.setup.score}<small> / 100</small></strong></div><div><span>Planned entry</span><strong>{dollars(plan.entry)}</strong></div><div><span>Simulated entry fill</span><strong>{dollars(p.signal.entryFill)}</strong></div><div><span>{p.settled ? "Exit fill" : "Fresh spot quote"}</span><strong>{p.settled ? dollars(p.signal.exitFill) : quote && mark !== null ? dollars(quote.price) : "—"}</strong></div></div>
          <div className="trade-targets"><span className="negative">SL <b>{dollars(plan.stopLoss)}</b></span>{plan.targets.map((target, i) => <span className={p.signal.highestTarget > i ? "target-touched" : ""} key={i}>TP{i + 1}<b>{dollars(target.price)}</b>{p.signal.highestTarget > i && <ShieldCheck size={13} />}</span>)}</div>
          <div className="trade-cost-note"><span>{plan.feeBps} bps fee + {plan.slippageBps} bps slippage / side</span><span>Max hold {p.signal.setup.holdingPeriodHours ?? 72}h · expiry {new Date(p.signal.setup.expiresAt).toLocaleString("en-US", { timeZoneName: "short" })}</span></div>
          <label className="journal-label"><BookOpen size={15} />Trading journal<textarea maxLength={10000} value={p.journal} onChange={e => onJournal(index, e.target.value)} placeholder="Why did you take this setup? What did you learn?" /></label>
          <details className="trade-audit"><summary>View recommendation & execution history<span>{p.signal.events.length} {p.signal.events.length === 1 ? "event" : "events"}</span></summary><div className="event-list">{p.signal.events.length ? p.signal.events.map(event => <div key={event.id}><span className="timeline-dot" /><div className="min-w-0 break-words"><strong>{event.type}</strong><p>{event.detail}</p><small>{new Date(event.at).toLocaleString("en-US", { timeZoneName: "short" })}{event.price !== null && ` · ${dollars(event.price)}`}</small></div></div>) : <p>Plan taken {new Date(p.signal.publishedAt).toLocaleString("en-US", { timeZoneName: "short" })}. Entry remains unfilled.</p>}</div><button className="text-button" onClick={() => downloadJson(`${p.signal.setup.id}-virtual-trade.json`, p)}>Download frozen recommendation & journal<ArrowDownToLine size={15} /></button></details>
          {!p.settled && <div className="trade-manage"><span>{p.signal.enteredAt ? "Manual exits first reconcile completed candles." : "Virtual cash is reserved until fill, cancellation, or expiry."}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => onManage(p, p.signal.enteredAt ? "close" : "cancel")}><X />{p.signal.enteredAt ? "Close virtual position" : "Cancel pending plan"}</Button></div>}
        </article>;
      })}</div> : <div className="empty-state large"><Wallet size={38} /><h3>{tab === "history" ? "Your track record starts here." : "Every good trade starts with a plan."}</h3><p>{tab === "history" ? "Completed virtual trades and cancelled plans appear here with their original recommendation, costs, and journal." : "Take a qualified BUY recommendation from the trade workspace. Its exact horizon, score, entry, stop, and targets are frozen in your local history."}</p><Button variant="outline" onClick={onExplore}>Explore real recommendations<ArrowRight /></Button></div>}
    </section><p className="footnote"><ShieldCheck size={16} />Virtual trading only. Price marks are live snapshots; automated outcomes use closed 15-minute OHLC for 15M research and hourly OHLC for other horizons with stop-first ambiguity and no entry-bar target credit. Export a backup before moving devices. Local records are separate from the public signal ledger.</p>
  </div>;
}
function RealizedCurve({ positions, initial }: { positions: PaperPosition[]; initial: number }) {
  if (!positions.length) return <div className="curve-empty"><div className="curve-grid" /><div><ActivityIcon /><strong>No completed trades yet</strong><p>Your curve will be drawn from your own completed simulations.</p></div></div>;
  const sorted = positions.slice().sort((a, b) => Date.parse(a.signal.exitAt!) - Date.parse(b.signal.exitAt!));
  const points = sorted.reduce<{ time: number; value: number }[]>((result, position) => [...result, { time: Date.parse(position.signal.exitAt!), value: result.at(-1)!.value + netPnl(position) }], [{ time: Date.parse(sorted[0].signal.publishedAt), value: initial }]);
  const balance = points.at(-1)!.value;
  const values = points.map(p => p.value), min = Math.min(...values), range = Math.max(...values) - min;
  const start = points[0].time, duration = points.at(-1)!.time - start || 1;
  const x = (t: number) => 10 + (t - start) / duration * 780;
  const y = (value: number) => range ? 155 - (value - min) / range * 130 : 85;
  let path = `M${x(points[0].time)},${y(points[0].value)}`;
  for (let i = 1; i < points.length; i++) path += `H${x(points[i].time)}V${y(points[i].value)}`;
  return <div className="portfolio-equity"><div><strong>{money(balance)}</strong><span className={balance >= initial ? "positive" : "negative"}>{percent((balance / initial - 1) * 100)} realized</span></div><svg viewBox="0 0 800 180" role="img" aria-label={`Realized virtual balance ${money(initial)} to ${money(balance)}`}><path d="M0 25H800M0 90H800M0 155H800" stroke="#263651" fill="none" /><path d={path} fill="none" stroke="#91b5ff" strokeWidth="2.5" /></svg><p><span>{new Date(start).toLocaleDateString("en-US")}</span><span>{new Date(points.at(-1)!.time).toLocaleDateString("en-US")}</span></p></div>;
}
function ActivityIcon() { return <svg width="29" height="29" viewBox="0 0 30 30" fill="none" aria-hidden="true"><path d="M3 19h6l4-12 5 17 4-10h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
