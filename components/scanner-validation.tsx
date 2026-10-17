"use client";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Database, FlaskConical, ShieldAlert } from "lucide-react";
import type { Timeframe } from "@/lib/types";
import type { ScannerValidationReport, ScannerValidationRow } from "@/lib/research/types";
import { STRATEGY_VERSION } from "@/lib/market/policy";
import { downloadJson } from "@/lib/download";
import { cn, dollars, percent } from "@/lib/utils";
import { Button } from "./ui/button";
import { HorizonSummaries } from "./edge-visuals";

const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const evidenceLabel = (row: ScannerValidationRow) => row.evidence === "insufficient" ? "Limited sample" : row.evidence === "unfavorable" ? "Unfavorable results" : "Positive in this sample";
export function ScannerValidation({ report }: { report: ScannerValidationReport | null }) {
  const [frame, setFrame] = useState<Timeframe>("1h");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  if (!report) return <section className="panel scanner-evidence"><div className="panel-heading"><h2>Actual scanner replay</h2><FlaskConical size={22} /></div><p className="panel-note">No replay of the recommendation rules has been published yet. The baseline strategies below do not establish scanner performance. No sample results are displayed.</p></section>;
  const rows = report.rows.filter(row => row.timeframe === frame);
  const selected = rows.find(row => row.symbol === symbol) ?? rows[0];
  const completed = report.rows.reduce((sum, row) => sum + row.completed, 0);
  const aged = now - Date.parse(report.generatedAt) > 48 * 3_600_000;
  return <section className="panel scanner-evidence">
    <div className="evidence-heading"><div className="min-w-0"><span className="eyebrow">ACTUAL SCANNER · {report.strategyVersion}</span><h2>Evidence before conviction.</h2><p>Replay of the same recommendation rules on Binance history. {date(report.start)} — {date(report.end)}.</p></div><Button variant="outline" onClick={() => downloadJson("cryptoscanora-scanner-replay.json", report)}><ArrowDownToLine size={17} />Export evidence</Button></div>
    <div className="evidence-verdict"><ShieldAlert size={24} /><div className="min-w-0"><strong>{report.rows.some(row => row.evidence === "unfavorable") ? "Some historical results are unfavorable" : report.rows.some(row => row.evidence === "insufficient") ? "Performance evidence remains limited" : "Historical results need forward testing"}</strong><p>{completed} completed trades across separate accounts. Standard indicators or popular repositories do not establish profitability. Setup quality is not a win probability.</p></div></div>
    <div className="evidence-assumptions"><span><b>{money(report.capitalPerAccount)}</b> per pair × horizon account</span><span><b>{report.initialCapitalRiskPct}%</b> of initial capital at risk</span><span><b>{(report.feeBps / 100).toFixed(2)}% + {(report.slippageBps / 100).toFixed(2)}%</b> fee + slippage / side</span><span><b>Hourly, :{String(report.assumedPublicationMinute).padStart(2, "0")}</b> assumed publication</span></div>
    <HorizonSummaries report={report} />
    <div className="evidence-controls"><div className="horizon-switch" aria-label="Replay timeframe">{frames.map(tf => <button key={tf} aria-pressed={frame === tf} className={cn(frame === tf && "active")} onClick={() => setFrame(tf)}>{tf.toUpperCase()}</button>)}</div><span><Database size={15} />Updated {new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })} WIB</span></div>
    {aged && <p className="warning-note">This report is over 48 hours old. It is the latest available historical result and has not been recalculated.</p>}
    {report.strategyVersion !== STRATEGY_VERSION && <p className="warning-note">This report uses {report.strategyVersion}. The current scanner uses {STRATEGY_VERSION}; earlier results do not establish the performance of the new rules. An updated replay is pending.</p>}
    {report.failures.length > 0 && <p className="warning-note">Replay data is incomplete: {report.failures.map(failure => `${failure.symbol}: ${failure.message}`).join("; ")}. Failed markets are not treated as zero returns.</p>}
    <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Market</th><th>Published BUYs</th><th>Closed trades</th><th>Win rate</th><th>Profit factor</th><th>Account return</th><th>Drawdown</th><th>Evidence</th></tr></thead><tbody>{rows.map(row => <tr key={row.symbol} className={cn(selected?.symbol === row.symbol && "selected")}><td><button onClick={() => setSymbol(row.symbol)} aria-pressed={selected?.symbol === row.symbol}>{row.symbol.replace("USDT", " / USDT")}</button></td><td>{row.publishedBuy}</td><td>{row.completed}</td><td>{row.winRate === null ? "—" : `${row.winRate.toFixed(1)}%`}</td><td>{row.profitFactor === null ? "—" : row.profitFactor.toFixed(2)}</td><td className={row.netReturnPct < 0 ? "negative" : ""}>{percent(row.netReturnPct)}</td><td>{row.maxDrawdownPct.toFixed(2)}%</td><td><span className="evidence-status">{evidenceLabel(row)}</span></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="panel-note">Replay is unavailable for this horizon. Check the data failures above.</p>}
    {selected && <div className="evidence-detail"><div className="panel-heading"><h3>{selected.symbol.replace("USDT", " / USDT")} · {frame.toUpperCase()}</h3><span className="micro-tag">{selected.scans.toLocaleString("en-US")} SCANS</span></div>
      <p className="panel-note">{selected.filled} entries filled · {selected.expired} BUYs expired · {selected.invalidated} BUYs invalidated · {selected.pending} pending · {selected.open} open · {selected.unsized} below minimum size. Account return includes open positions marked after estimated exit costs; win rate includes closed trades only.</p>
      {selected.filled > 0 ? <EvidenceEquity row={selected} /> : <p className="evidence-no-trades">No entries filled. A zero return means the account remained in cash; it does not establish strategy safety or profitability.</p>}
      <div className="evidence-windows">{selected.windows.map((window, i) => <div key={window.start}><span>Period {i + 1} · {window.completed} closed trades</span><strong className={window.netReturnPct < 0 ? "negative" : ""}>{percent(window.netReturnPct)}</strong><small>{date(window.start)} — {date(window.end)}</small></div>)}</div>
      <p className="panel-note">Three consecutive periods use a continuing account. These descriptive splits are not three independent, unseen out-of-sample tests.</p>
      <details className="evidence-audit"><summary>Audit {selected.completed} closed trades & calculation assumptions</summary><p>Trade expectancy: <b>{selected.expectancyPct === null ? "—" : percent(selected.expectancyPct)}</b>. Fees and slippage are included. {report.strategyVersion === "cx-spot-5" || report.summaries ? "Managed plans sell half at TP1 and protect the remainder with a breakeven/ATR trailing stop; the exit fill is quantity-weighted." : "TP1/2 are milestones with no partial profit taking."}</p>
        {selected.trades.length > 0 && <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Entry · WIB</th><th>Exit · WIB</th><th>Entry fill</th><th>Exit fill</th><th>Net P/L</th><th>Status</th></tr></thead><tbody>{selected.trades.map(trade => <tr key={trade.id}><td>{new Date(trade.enteredAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })}</td><td>{new Date(trade.exitAt).toLocaleString("en-US", { timeZone: "Asia/Jakarta" })}</td><td>{dollars(trade.entryFill)}</td><td>{dollars(trade.exitFill)}</td><td className={trade.pnl < 0 ? "negative" : ""}>{money(trade.pnl)} · {percent(trade.returnPct)}</td><td>{trade.status}</td></tr>)}</tbody></table></div>}
        <p>{report.closedWindow} closed candles per frame. 15M uses 15-minute execution candles; other horizons use hourly candles. Actual GitHub publication may be later than the assumed :{String(report.assumedPublicationMinute).padStart(2, "0")}.</p>
        <p>Historical 24-hour tickers are reconstructed from closed 1H candles. The {report.symbols.map(symbol => symbol.replace(/USDT$/, "")).join("/")} universe and current exchange filters limit generalization. OHLC fills are simulations without tick-level execution verification.</p>
        <p>Fewer than 30 closed trades receive a limited-sample label. This is a sample-size warning, not a significance test. Positive results do not guarantee future profits.</p>
        <details><summary>Runner notes & code identity</summary>{report.notes.map((note, i) => <p key={i}>{note}</p>)}<code className="evidence-hash">SHA256 {report.codeHash}</code></details>
      </details>
    </div>}
  </section>;
}
function EvidenceEquity({ row }: { row: ScannerValidationRow }) {
  if (row.equity.length < 2) return <p className="panel-note">Not enough equity observations to draw a chart.</p>;
  const values = row.equity.map(point => point.value), low = Math.min(...values), high = Math.max(...values), spread = high - low || 1;
  const points = row.equity.map((point, i) => `${i / (row.equity.length - 1) * 800},${160 - (point.value - low) / spread * 130}`).join(" ");
  return <div className="evidence-equity"><div><span>Account equity · daily samples</span><b>{money(values[0])} → {money(values.at(-1)!)}</b></div><svg viewBox="0 0 800 185" role="img" aria-label={`${row.symbol} ${row.timeframe} equity, ${money(low)} to ${money(high)}`}><path d="M0 30H800M0 95H800M0 160H800" stroke="#293145" fill="none" /><polyline points={points} stroke={row.netReturnPct < 0 ? "#e399ac" : "#8dafff"} strokeWidth="2.5" fill="none" /></svg></div>;
}
