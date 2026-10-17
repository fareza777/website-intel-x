"use client";
import { ArrowUpRight, Orbit } from "lucide-react";
import type { MarketSetup, MarketSnapshot, Timeframe } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Overview hero: one glance at market tone, participation and what the engine is willing to do. */
export function MarketPulse({ setups, snapshot, timeframe, onRotation }: { setups: MarketSetup[]; snapshot: MarketSnapshot; timeframe: Timeframe; onRotation: () => void }) {
  const market = setups.find(setup => setup.market)?.market;
  const buys = setups.filter(setup => setup.action === "BUY").length, waits = setups.filter(setup => setup.action === "WAIT").length;
  const breadth = market?.breadth ?? (setups.length ? setups.filter(setup => setup.indicators["1d"].trend === "bullish").length / setups.length : null);
  const tone = market?.riskOff ? "risk-off" : market?.btcTrend === "bullish" && (breadth ?? 0) >= .5 ? "risk-on" : "mixed";
  const headline = tone === "risk-off" ? "Defensive. New long plans are paused." : tone === "risk-on" ? "Supportive tape. Leaders are trending." : "Mixed tape. Be selective.";
  const rotation = snapshot.rotation;
  const pct = breadth === null ? null : Math.round(breadth * 100);
  return <section className={cn("market-pulse", tone)}>
    <div className="pulse-radar" aria-hidden="true"><span className="ring r1" /><span className="ring r2" /><span className="ring r3" /><span className="sweep" />
      {setups.slice(0, 12).map((setup, i) => <i key={setup.id} className={cn("blip", setup.action === "BUY" ? "buy" : setup.action === "WAIT" ? "wait" : "")} style={{ ["--a" as string]: `${i * 137.5}deg`, ["--d" as string]: `${28 + (setup.score / 100) * 60}px` }} />)}
    </div>
    <div className="pulse-copy">
      <span className="pulse-kicker">MARKET PULSE · {timeframe.toUpperCase()}</span>
      <h2>{headline}</h2>
      <p>{market?.detail ?? "Market context arrives with the next scheduled scan."}</p>
    </div>
    <div className="pulse-kpis">
      <div className="kpi"><span>Qualified BUY</span><strong className="glow-buy">{buys}</strong><small>{waits} waiting for a trigger</small></div>
      <div className="kpi"><span>Breadth</span><div className="kpi-ring" style={{ ["--p" as string]: `${pct ?? 0}%` }}><strong>{pct === null ? "—" : `${pct}%`}</strong></div><small>above EMA50</small></div>
      <div className="kpi"><span>BTC trend</span><strong className={market?.btcTrend === "bullish" ? "positive" : market?.btcTrend === "bearish" ? "negative" : "muted"}>{market?.btcTrend ?? "—"}</strong><small>higher timeframe</small></div>
      <button className="kpi kpi-link" onClick={onRotation}><span><Orbit size={14} /> Rotation</span><strong className={rotation?.regimeOn ? "positive" : "muted"}>{rotation ? rotation.regimeOn ? rotation.picks.map(pick => pick.symbol.replace(/USDT$/, "")).join(" · ") || "—" : "Cash" : "—"}</strong><small>Open portfolio <ArrowUpRight size={13} /></small></button>
    </div>
  </section>;
}
