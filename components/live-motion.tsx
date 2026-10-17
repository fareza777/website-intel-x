"use client";
import { useEffect, useRef } from "react";
import { Radio, TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { MarketSetup, SignalEvent, SpotQuote } from "@/lib/types";
import { freshQuotePrice, freshQuoteStats } from "@/lib/live-market";
import { cn, dollars, percent, relativeTime } from "@/lib/utils";
import { CoinIcon } from "./research-panel";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Flashes up/down when a live value changes. The DOM class is toggled in an effect, so renders stay pure. */
export function FlashValue({ value, children, className }: { value: number | null; children: React.ReactNode; className?: string }) {
  const node = useRef<HTMLSpanElement>(null), previous = useRef<number | null>(value);
  useEffect(() => {
    const element = node.current, before = previous.current;
    previous.current = value;
    if (!element || value === null || before === null || value === before || reducedMotion()) return;
    element.classList.remove("flash-up", "flash-down");
    void element.offsetWidth; // Restart the animation when two updates arrive back to back.
    element.classList.add(value > before ? "flash-up" : "flash-down");
  }, [value]);
  return <span ref={node} className={cn("flash-value", className)}>{children}</span>;
}

/** Counts from the previous value to the new one; text is written directly to avoid re-render loops. */
export function CountUp({ value, format = v => Math.round(v).toLocaleString("en-US"), duration = 900 }: { value: number; format?: (value: number) => string; duration?: number }) {
  const node = useRef<HTMLSpanElement>(null), shown = useRef(0);
  useEffect(() => {
    const element = node.current;
    if (!element || !Number.isFinite(value)) return;
    const from = shown.current, start = performance.now();
    if (reducedMotion() || from === value) { element.textContent = format(value); shown.current = value; return; }
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      shown.current = from + (value - from) * eased;
      element.textContent = format(shown.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, format, duration]);
  return <span ref={node}>{format(0)}</span>;
}

/** Continuous marquee of every scanned market with live price and 24h change; pauses on hover or focus. */
export function TickerTape({ setups, quotes, clock, onSelect }: { setups: MarketSetup[]; quotes: Record<string, SpotQuote>; clock: number; onSelect: (symbol: string) => void }) {
  if (!setups.length) return null;
  const items = setups.map(setup => ({ setup, price: freshQuotePrice(quotes[setup.symbol], setup.symbol, clock), stats: freshQuoteStats(quotes[setup.symbol], setup.symbol, clock) }));
  const row = (copy: number) => items.map(({ setup, price, stats }) => <button key={`${copy}-${setup.symbol}`} className="tape-item" tabIndex={copy ? -1 : 0} aria-hidden={copy ? true : undefined} onClick={() => onSelect(setup.symbol)}>
    <i className={cn("tape-dot", setup.action === "BUY" ? "buy" : setup.action === "WAIT" ? "wait" : "")} />
    <strong>{setup.baseAsset}</strong>
    <FlashValue value={price}>{dollars(price)}</FlashValue>
    <span className={cn("tape-change", stats ? stats.change24h >= 0 ? "up" : "down" : "muted")}>{stats ? <>{stats.change24h >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{percent(stats.change24h)}</> : "—"}</span>
  </button>);
  return <div className="ticker-tape" role="region" aria-label="Live market ticker">
    <span className="tape-label"><Radio size={14} />LIVE</span>
    <div className="tape-viewport"><div className="tape-track" style={{ ["--tape-duration" as string]: `${Math.max(40, items.length * 3.2)}s` }}>{row(0)}{row(1)}</div></div>
  </div>;
}

/** Strongest and weakest live 24h movers with animated bars. */
export function TopMovers({ setups, quotes, clock, onSelect }: { setups: MarketSetup[]; quotes: Record<string, SpotQuote>; clock: number; onSelect: (symbol: string) => void }) {
  const moving = setups.flatMap(setup => { const stats = freshQuoteStats(quotes[setup.symbol], setup.symbol, clock); return stats ? [{ setup, change: stats.change24h }] : []; })
    .sort((a, b) => b.change - a.change);
  const gainers = moving.slice(0, 5), losers = moving.slice(-5).reverse().filter(item => !gainers.includes(item));
  const scale = Math.max(1, ...moving.map(item => Math.abs(item.change)));
  const list = (items: typeof moving, tone: "up" | "down") => items.map(({ setup, change }, i) => <button key={setup.symbol} className={cn("mover", tone)} style={{ ["--i" as string]: i }} onClick={() => onSelect(setup.symbol)}>
    <CoinIcon asset={setup.baseAsset} small /><strong>{setup.baseAsset}</strong>
    <span className="mover-bar"><i style={{ width: `${Math.max(4, Math.abs(change) / scale * 100)}%` }} /></span>
    <b>{percent(change)}</b>
  </button>);
  return <section className="panel movers-panel">
    <div className="panel-heading"><div><h2>Top movers</h2><p>Live rolling 24h change across the scanned universe.</p></div><Zap size={20} /></div>
    {moving.length ? <div className="movers-grid"><div><span className="movers-title up"><TrendingUp size={15} /> Gainers</span>{list(gainers, "up")}</div><div><span className="movers-title down"><TrendingDown size={15} /> Losers</span>{list(losers, "down")}</div></div>
      : <p className="panel-note">Waiting for fresh live quotes.</p>}
  </section>;
}

function marketOf(signalId: string): string | null {
  const [symbol, frame] = signalId.split("-");
  if (!/^[A-Z0-9]{1,26}USDT$/.test(symbol ?? "")) return null;
  return `${symbol.replace(/USDT$/, "")}${/^(15m|1h|4h|1d)$/.test(frame ?? "") ? ` · ${frame.toUpperCase()}` : ""}`;
}

/** Recent published plans, fills and exits scrolling as a live feed. */
export function ActivityFeed({ alerts }: { alerts: SignalEvent[] }) {
  const recent = alerts.slice(-14).reverse();
  if (!recent.length) return null;
  const tone = (type: string) => /PUBLISHED|TP|SCALE/.test(type) ? "good" : /STOP|INVALID|EXPIRED/.test(type) ? "bad" : "info";
  return <section className="panel feed-panel">
    <div className="panel-heading"><div><h2>Live activity</h2><p>Published plans, simulated fills and exits from the public ledger.</p></div><span className="live-pill"><i />STREAM</span></div>
    <div className="feed-viewport"><ul className="feed-track" style={{ ["--feed-duration" as string]: `${Math.max(24, recent.length * 3.5)}s` }}>
      {[0, 1].flatMap(copy => recent.map(alert => <li key={`${copy}-${alert.id}`} aria-hidden={copy ? true : undefined} className={cn("feed-item", tone(alert.type))}>
        <i />
        <div><strong>{alert.type}{marketOf(alert.signalId) && <em>{marketOf(alert.signalId)}</em>}</strong><p>{alert.price != null ? `${dollars(alert.price)} · ` : ""}{relativeTime(alert.at)}</p></div>
      </li>))}
    </ul></div>
  </section>;
}
