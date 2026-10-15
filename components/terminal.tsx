"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ElementType } from "react";
import { Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, ChartCandlestick, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Crosshair, FlaskConical, Globe2, LayoutDashboard, ListFilter, Menu, Plus, Radio, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, SlidersHorizontal, Star, Wallet, Waves, X } from "lucide-react";
import type { AnalyticsReport, MarketSetup, MarketSnapshot, SignalEvent, SpotQuote, Timeframe, TrackedSignal } from "@/lib/types";
import { cn, dollars, isStale, relativeTime } from "@/lib/utils";
import { applyPaperUpdates, createPaperAccount, importPaperAccount, reservePosition, settlePaperPosition, type PaperAccount, type PaperPosition } from "@/lib/paper";
import { advanceSignal, hasCompleteSignalHistory } from "@/lib/tracking";
import { readLocalPortfolio, saveLocalPortfolio } from "@/lib/local-store";
import { preferencesSchema, seenAlertsSchema, watchlistSchema } from "@/lib/validation";
import { freshQuotePrice, nextScheduledScan, quoteSubscription, QUOTE_REFRESH_MS, SCAN_CADENCE, SCAN_INTERVAL_HOURS } from "@/lib/live-market";
import { MarketChart, Sparkline } from "./market-chart";
import { ActionBadge, Change, CoinIcon, ResearchPanel, TechnicalContext, TimeframeAgreement } from "./research-panel";
import { HistoryView } from "./history-view";
import { LiquidityView, VolumeView } from "./intelligence-views";
import { StrategyView } from "./strategy-view";
import { PaperView } from "./paper-view";
import { MarketEligibility } from "./market-eligibility";
import { compareOpportunities, setupBlockers } from "@/lib/opportunities";
import { AlertsView } from "./alerts-view";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

type View = "overview" | "radar" | "workspace" | "liquidity" | "volume" | "autopsy" | "strategy" | "paper" | "alerts" | "settings";
interface TerminalData { snapshot: MarketSnapshot; signals: TrackedSignal[]; alerts: SignalEvent[]; analytics: AnalyticsReport | null; persistence: string; preview: boolean; stale: boolean }
interface Preferences { capital: number; risk: number; universe: number; useWatchlist: boolean; largeText: boolean }
const defaults: Preferences = { capital: 10000, risk: 1, universe: 30, useWatchlist: false, largeText: false };
const navigation: { id: View; label: string; icon: ElementType; group?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "WORKSPACE" },
  { id: "radar", label: "Opportunity radar", icon: Radio },
  { id: "workspace", label: "Trade workspace", icon: ChartCandlestick },
  { id: "liquidity", label: "Liquidity radar", icon: Waves, group: "MARKET INTELLIGENCE" },
  { id: "volume", label: "Volume intelligence", icon: Activity },
  { id: "autopsy", label: "Signal autopsy", icon: Crosshair, group: "RESEARCH & PERFORMANCE" },
  { id: "strategy", label: "Strategy lab", icon: FlaskConical },
  { id: "paper", label: "Paper trading", icon: Wallet },
  { id: "alerts", label: "Smart alerts", icon: Bell },
];
const titles: Record<View, { title: string; subtitle: string }> = {
  overview: { title: "Market overview", subtitle: "Less noise. More intelligence. Your edge starts here." },
  radar: { title: "Opportunity radar", subtitle: "Find confluence across the market. Trade only when the evidence agrees." },
  workspace: { title: "Trade workspace", subtitle: "A precise plan for every qualified opportunity." },
  liquidity: { title: "Liquidity radar", subtitle: "Look beneath the price. Understand the structure." },
  volume: { title: "Volume intelligence", subtitle: "See where participation meets price." },
  autopsy: { title: "Signal autopsy", subtitle: "Transparent recommendations. Accountable outcomes." },
  strategy: { title: "Strategy lab", subtitle: "Challenge the thesis before you trust the strategy." },
  paper: { title: "Paper trading", subtitle: "Build discipline with real data and virtual capital." },
  alerts: { title: "Smart alerts", subtitle: "Meaningful market events, without the noise." },
  settings: { title: "Terminal settings", subtitle: "Make the workspace fit your research process." },
};
function readLocal<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }

export function Terminal() {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<TerminalData | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState("opportunity");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [paper, setPaper] = useState<PaperAccount>(createPaperAccount());
  const [paperBusy, setPaperBusy] = useState(false);
  const [paperAction, setPaperAction] = useState("");
  const [quotes, setQuotes] = useState<Record<string, SpotQuote>>({});
  const [clock, setClock] = useState(Date.now);
  const [hydrated, setHydrated] = useState(false);
  const [paperStorageReady, setPaperStorageReady] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [notifications, setNotifications] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [watchText, setWatchText] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showStructure, setShowStructure] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const notified = useRef<Set<string>>(new Set());
  const initializedAlerts = useRef(false);
  const previewRef = useRef(false);
  const paperGeneration = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const setups = data?.snapshot.timeframes?.[timeframe] || (timeframe === "1h" ? data?.snapshot.setups || [] : []);
  const marketView = ["overview", "radar", "workspace", "liquidity", "volume"].includes(view);
  const horizonAvailable = timeframe === "1h" || !!data?.snapshot.timeframes?.[timeframe];
  const selected = setups.find(s => s.symbol === symbol) || setups[0];
  const quoteSymbols = quoteSubscription(marketView ? setups.map(s => s.symbol) : [], paper.positions.filter(p => !p.settled).map(p => p.signal.setup.symbol), marketView ? selected?.symbol : undefined).join(",");
  const selectedLivePrice = selected ? freshQuotePrice(quotes[selected.symbol], selected.symbol, clock) : null;
  const qualified = setups.filter(s => s.action === "BUY");
  const stale = data ? isStale(data.snapshot.generatedAt) || data.snapshot.status === "unavailable" : false;
  const unread = data?.alerts.filter(a => !seen.includes(a.id)).length || 0;

  const loadPublished = useCallback((force = false) => {
    return fetch("/api/market", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("The market service is unavailable. Please retry.");
      return await response.json() as TerminalData;
    }).then(result => {
      setData(current => ({ ...result, preview: previewRef.current && !force ? true : result.preview, snapshot: current && ((previewRef.current && !force) || (current.snapshot.generatedAt === result.snapshot.generatedAt && current.snapshot.status === result.snapshot.status)) ? current.snapshot : result.snapshot })); setLoadError("");
      if (force) { previewRef.current = false; setRefresh(v => v + 1); }
    }).catch(e => { setLoadError(e instanceof Error ? e.message : "Could not load the market."); });
  }, []);
  useEffect(() => {
    void loadPublished();
    const interval = setInterval(() => void loadPublished(), 60_000);
    const onFocus = () => void loadPublished();
    const onVisible = () => { if (document.visibilityState === "visible") void loadPublished(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadPublished]);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    async function restore() {
      const storedPreferences = preferencesSchema.safeParse(readLocal<unknown>("cix-preferences", defaults));
      setPreferences(storedPreferences.success ? storedPreferences.data : defaults);
      const storedWatchlist = watchlistSchema.safeParse(readLocal<unknown>("cix-watchlist", ["BTCUSDT", "ETHUSDT", "SOLUSDT"]));
      setWatchlist(storedWatchlist.success ? storedWatchlist.data : ["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
      const storedSeen = seenAlertsSchema.safeParse(readLocal<unknown>("cix-seen-alerts", []));
      setSeen(storedSeen.success ? storedSeen.data : []);
      try { const stored = await readLocalPortfolio(); if (stored) setPaper(stored); setPaperStorageReady(true); } catch { notify("A saved portfolio could not be read. Its original data was preserved; import a valid backup to recover it."); }
      setNotifications(typeof Notification !== "undefined" && Notification.permission === "granted");
      setHydrated(true);
    }
    void restore();
  }, [notify]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("cix-preferences", JSON.stringify(preferences)); localStorage.setItem("cix-watchlist", JSON.stringify(watchlist)); localStorage.setItem("cix-seen-alerts", JSON.stringify(seen.slice(-1000))); }
    catch { window.setTimeout(() => notify("Device storage is unavailable or full. Export your portfolio to preserve it."), 0); }
  }, [preferences, watchlist, seen, paper, hydrated, notify]);
  useEffect(() => {
    if (hydrated && paperStorageReady) void saveLocalPortfolio(paper).catch(() => notify("Local portfolio storage failed. Export a backup to preserve the current account."));
  }, [paper, hydrated, paperStorageReady, notify]);
  useEffect(() => {
    if (!data) return;
    if (!initializedAlerts.current) { data.alerts.forEach(a => notified.current.add(a.id)); initializedAlerts.current = true; return; }
    for (const alert of data.alerts) {
      if (!notified.current.has(alert.id)) {
        notified.current.add(alert.id);
        if (notifications && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(`CryptoIntel X · ${alert.type}`, { body: alert.detail, tag: alert.id, icon: "/icon.svg" });
      }
    }
  }, [data, notifications]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) { if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); searchRef.current?.focus(); } if (event.key === "Escape") setMobileOpen(false); }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, []);
  function navigate(next: View) { setView(next); setMobileOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function selectAsset(next: string) { setSymbol(next); setView("workspace"); }
  function toggleWatch(next: string) { setWatchlist(current => current.includes(next) ? current.filter(s => s !== next) : current.length < 50 ? [...current, next] : current); }
  async function scan() {
    setBusy(true); setLoadError("");
    try {
      const response = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: preferences.universe, ...(preferences.useWatchlist && watchlist.length ? { symbols: watchlist } : {}) }) });
      const result = await response.json();
      if (!response.ok && !result.snapshot) throw new Error(result.error || "The scan could not complete.");
      previewRef.current = true;
      setData(current => ({ snapshot: result.snapshot, signals: current?.signals || [], alerts: current?.alerts || [], analytics: current?.analytics || null, persistence: current?.persistence || "unavailable", preview: true, stale: false }));
      setRefresh(v => v + 1);
      notify(result.snapshot.status === "unavailable" ? "Exchange data is unavailable. No signals were generated." : `${result.snapshot.scanned} assets scanned. Live preview ready.`);
    } catch (e) { notify(e instanceof Error ? e.message : "Scan failed."); }
    finally { setBusy(false); }
  }
  function simulate() {
    if (!paperStorageReady) return notify("Recover the saved local portfolio with a valid import before taking a new plan.");
    if (!selected || stale) return;
    try { setPaper(reservePosition(paper, selected, preferences.risk)); navigate("paper"); notify(`${selected.baseAsset} plan added. Virtual cash reserved; awaiting a future entry.`); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not simulate this plan."); }
  }
  const updatePaper = useCallback(async (silent = false) => {
    setPaperBusy(true);
    const generation = paperGeneration.current;
    const updates: TrackedSignal[] = [];
    let failures = 0;
    for (const p of paper.positions) {
      if (p.settled) continue;
      try {
        const start = p.signal.lastEvaluatedTime ? p.signal.lastEvaluatedTime + 3_600_000 : Math.ceil(Date.parse(p.signal.publishedAt) / 3_600_000) * 3_600_000;
        const response = await fetch(`/api/candles?symbol=${p.signal.setup.symbol}&interval=1h&limit=1000&startTime=${start}`);
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        const updated = advanceSignal(p.signal, result.candles, Date.now());
        updates.push(updated);
        if (!hasCompleteSignalHistory(updated, Date.now())) failures++;
      } catch { failures++; }
    }
    if (paperGeneration.current === generation) setPaper(current => applyPaperUpdates(current, updates));
    setPaperBusy(false);
    if (!silent || failures) notify(failures ? `${failures} position histories are incomplete or unavailable. Recover closed candles before manual management.` : "Simulations reconciled against closed Binance candles.");
    return failures === 0 && paperGeneration.current === generation;
  }, [paper, notify]);
  useEffect(() => {
    if (paperBusy || !paper.positions.some(p => !p.settled)) return;
    const interval = setInterval(() => void updatePaper(true), 60_000);
    return () => clearInterval(interval);
  }, [paperBusy, paper.positions, updatePaper]);
  useEffect(() => {
    if (!quoteSymbols) return;
    const controller = new AbortController();
    let inFlight = false;
    async function refreshQuotes() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/quotes?symbols=${quoteSymbols}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (response.ok && Array.isArray(result.quotes) && !controller.signal.aborted) {
          const receivedAt = Date.now();
          const requested = new Set(quoteSymbols.split(","));
          const valid = result.quotes.filter((quote: SpotQuote) => requested.has(quote.symbol) && freshQuotePrice(quote, quote.symbol, receivedAt) !== null);
          setQuotes(current => ({ ...current, ...Object.fromEntries(valid.map((quote: SpotQuote) => [quote.symbol, quote])) }));
          setClock(receivedAt);
        }
      } catch { /* Last quote timestamps remain visible; stale quotes are never marked current. */ }
      finally { inFlight = false; }
    }
    void refreshQuotes();
    const interval = setInterval(() => { if (document.visibilityState === "visible") void refreshQuotes(); }, QUOTE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshQuotes(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [quoteSymbols]);
  function importPortfolio(value: string) { try { const imported = importPaperAccount(value); paperGeneration.current++; setPaper(imported); setPaperStorageReady(true); notify("Virtual portfolio imported and saved on this device."); } catch { notify("Invalid portfolio file. The current portfolio was preserved."); } }
  async function managePaper(position: PaperPosition, kind: "cancel" | "close") {
    if (paperBusy || paperAction) return;
    const generation = paperGeneration.current;
    setPaperAction(position.signal.setup.id);
    try {
      if (!await updatePaper(true)) throw new Error("Closed market history must be available before changing a virtual position.");
      let quote: SpotQuote | undefined;
      if (kind === "close") {
        const response = await fetch(`/api/quotes?symbols=${position.signal.setup.symbol}`);
        const result = await response.json();
        if (!response.ok || !result.quotes?.[0]) throw new Error("Fresh Binance pricing is unavailable. The position was preserved.");
        quote = result.quotes[0];
      }
      if (paperGeneration.current !== generation) throw new Error("Portfolio changed during reconciliation. Please retry with the current account.");
      const action = kind === "close" && quote ? { kind: "close" as const, quote } : { kind: "cancel" as const };
      setPaper(current => {
        try {
          const next = settlePaperPosition(current, position.signal.setup.id, position.signal.publishedAt, action);
          window.setTimeout(() => notify(next === current ? "The position has already been settled by its rules." : kind === "close" ? "Virtual position closed at a fresh Binance quote, after costs." : "Unfilled plan cancelled. Virtual cash released."), 0);
          return next;
        } catch (e) { window.setTimeout(() => notify(e instanceof Error ? e.message : "Could not update the virtual position."), 0); return current; }
      });
    } catch (e) { notify(e instanceof Error ? e.message : "Virtual position update failed."); }
    finally { setPaperAction(""); }
  }
  function setStartingCapital(value: number) { try { if (!paperStorageReady) throw new Error("Import a valid backup to recover the saved account first."); if (paper.positions.length) throw new Error("Starting capital is fixed once a plan has been taken."); setPaper(createPaperAccount(value)); notify("Starting virtual capital updated."); } catch (e) { notify(e instanceof Error ? e.message : "Invalid capital."); } }
  function readAlerts(ids: string[]) { setSeen(current => [...new Set([...current, ...ids])].slice(-1000)); }
  async function enableNotifications() { if (typeof Notification === "undefined") return notify("This browser does not support notifications."); const permission = await Notification.requestPermission(); setNotifications(permission === "granted"); notify(permission === "granted" ? "New market events will notify you while the terminal is open." : "Browser notifications were not enabled. Events remain in the inbox."); }
  function saveWatchlist() { const symbols = [...new Set(watchText.toUpperCase().split(/[\s,;]+/).filter(Boolean).map(s => s.replace("/", "")).map(s => s.endsWith("USDT") ? s : `${s}USDT`))]; if (symbols.length > 50 || symbols.some(s => !/^[A-Z0-9]{1,26}USDT$/.test(s))) return notify("Enter up to 50 valid spot assets, such as BTC, ETH, SOL."); setWatchlist(symbols); setWatchlistOpen(false); notify("Watchlist saved on this device."); }
  const filtered = setups.filter(s => (!search || `${s.name} ${s.symbol}`.toLowerCase().includes(search.toLowerCase())) && (actionFilter === "all" || s.action === actionFilter) && s.score >= minScore && (!onlyWatchlist || watchlist.includes(s.symbol))).sort((a, b) => sort === "opportunity" ? compareOpportunities(a, b) : sort === "volume" ? b.quoteVolume24h - a.quoteVolume24h : sort === "change" ? b.change24h - a.change24h : b.score - a.score);
  const tickers = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].map(s => setups.find(x => x.symbol === s)).filter((s): s is MarketSetup => !!s);
  const title = titles[view];
  return <div className={cn("terminal", preferences.largeText && "large-text")}>
    {mobileOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={cn("sidebar", mobileOpen && "open")}>
      <Link className="brand" href="/" aria-label="CryptoIntel X home"><span className="brand-mark"><svg width="23" height="23" viewBox="0 0 32 32" fill="none"><path d="M5 6h7l15 20h-7L5 6ZM20 6h7L12 26H5L20 6Z" fill="currentColor" /></svg></span><span>CryptoIntel <b>X</b><small>RESEARCH TERMINAL</small></span></Link>
      <div className="workspace-switch"><span className="workspace-avatar">X</span><div><strong>Research workspace</strong><small>Personal terminal</small></div><ChevronDown size={16} /></div>
      <nav aria-label="Main navigation">{navigation.map(item => <div key={item.id}>{item.group && <div className="nav-group">{item.group}</div>}<button className={cn("nav-item", view === item.id && "active")} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><item.icon size={20} /><span>{item.label}</span>{item.id === "radar" && !!qualified.length && <b>{qualified.length}</b>}{item.id === "alerts" && !!unread && <b>{unread}</b>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="engine-card"><span className="engine-symbol"><ShieldCheck size={21} /></span><strong>Intelligence, on autopilot.</strong><p>Recommendation scans every {SCAN_CADENCE}. Live prices every 30 seconds.</p><span><i className="blue-dot" />RULE-BASED ENGINE</span></div><button className={cn("nav-item", view === "settings" && "active")} onClick={() => navigate("settings")}><Settings2 size={20} /><span>Settings</span></button><button className="nav-item" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /><span>About the methodology</span><ArrowUpRight size={16} /></button><div className="sidebar-footer"><span className="blue-dot" />Spot research only<span>v1.0</span></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button><span className="breadcrumb">Workspace <ChevronRight size={16} /><strong>{view === "overview" ? "Overview" : title.title}</strong></span></div><div className="global-search"><Search size={18} /><input aria-label="Search markets" placeholder="Search markets…" ref={searchRef} value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) setView("radar"); }} /><kbd>/</kbd></div><div className="topbar-right"><span className={cn("connection-status", (!data || stale) && "disconnected")}><i />{!data ? "Connecting" : stale ? "Data stale" : data.snapshot.status === "partial" ? "Partial data" : "Market connected"}</span><span className="topbar-divider" /><button className="icon-button bell-button" aria-label={`Open alerts, ${unread} unread`} onClick={() => navigate("alerts")}><Bell size={21} />{!!unread && <i />}</button><button className="account-button" aria-label="Open settings" onClick={() => navigate("settings")}>X</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span className="blue-dot" />CRYPTOINTEL X / MARKET INTELLIGENCE</div><h1>{title.title}<span className="heading-dot">.</span></h1><p>{title.subtitle}</p></div><div className="page-actions"><Button variant="outline" onClick={() => { setWatchText(watchlist.map(s => s.replace(/USDT$/, "")).join(", ")); setWatchlistOpen(true); }}><Star />Watchlist</Button><Button onClick={scan} disabled={busy}><RefreshCw className={busy ? "spin" : ""} />{busy ? "Scanning markets…" : "Scan markets"}</Button></div></div>
        <div className="scan-meta"><span><Clock3 size={15} />{data ? `Last recommendation scan ${relativeTime(data.snapshot.generatedAt)}` : "Connecting to real market data…"}</span><span><Globe2 size={15} />Binance public spot</span><span className="scheduled"><i className="blue-dot" />Every {SCAN_CADENCE}</span><span title="Nominal UTC schedule. GitHub Actions can start later during busy periods."><Clock3 size={15} />Next scheduled {hydrated ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(nextScheduledScan(clock)) : "…"}</span>{data?.preview && <button onClick={() => void loadPublished(true)}>Manual preview · return to scheduled scan <ArrowRight size={14} /></button>}</div>
        {data && marketView && <div className="update-policy" aria-label="Market update status"><span className={selectedLivePrice === null ? "unavailable" : ""}><i />{selectedLivePrice === null ? "Live quote unavailable" : "Live prices · every 30s"}</span><span>Closed candles · every minute</span><span>Recommendations · every {SCAN_INTERVAL_HOURS}h</span></div>}
        {(loadError || stale || data?.snapshot.status === "partial") && <div className="status-banner"><Activity size={19} /><span>{loadError || (stale ? "Market data is stale or unavailable. Trade simulation is disabled until fresh data arrives." : `${data?.snapshot.errors.length} markets could not be analyzed. Only verified data is displayed.`)}</span><button onClick={() => void loadPublished(true)}>Refresh</button></div>}
        {data && marketView && <div className="horizon-bar"><div><span>RESEARCH HORIZON</span><div className="segment">{(["1h", "4h", "1d"] as Timeframe[]).map(tf => <button key={tf} className={timeframe === tf ? "active" : ""} aria-label={`${tf.toUpperCase()} research horizon`} onClick={() => setTimeframe(tf)}>{tf.toUpperCase()}</button>)}</div></div><p>Independent scores, entry levels, targets, and expiry for each horizon.</p></div>}
        {data && horizonAvailable && ["overview", "radar", "workspace"].includes(view) && <MarketEligibility setups={setups} timeframe={timeframe} onFilter={action => { setActionFilter(action); setSearch(""); setMinScore(0); setOnlyWatchlist(false); navigate("radar"); }} />}
        {!data ? <div className="terminal-loading"><div className="loading-radar"><ScanLine size={37} /></div><h2>Connecting the dots.</h2><p>Loading real market prices and closed-candle analysis.</p><span>EMA · RSI · MACD · ATR · market structure</span>{loadError && <Button variant="outline" onClick={() => void loadPublished(true)}>Retry connection</Button>}</div> : !horizonAvailable && marketView ? <section className="panel"><div className="empty-state large"><Clock3 size={35} /><h2>{timeframe.toUpperCase()} research is not available yet</h2><p>Run a new market scan to calculate this horizon from its own closed candles.</p><Button onClick={scan} disabled={busy}>Calculate research</Button></div></section> : <>
          {(view === "overview" || view === "radar") && <>
            {view === "overview" && tickers.length > 0 && <div className="ticker-strip">{tickers.map(s => <button key={s.id} onClick={() => selectAsset(s.symbol)}><CoinIcon asset={s.baseAsset} small /><span><strong>{s.baseAsset}</strong><small>USDT · LIVE</small></span><b>{dollars(freshQuotePrice(quotes[s.symbol], s.symbol, clock))}</b><Change value={s.change24h} /><ArrowUpRight size={15} /></button>)}</div>}
            <div className="stat-grid overview-stats"><Stat label="Assets scanned" value={String(setups.length)} note="Liquid USDT spot markets" icon={ScanLine} /><Stat label="Qualified setups" value={String(qualified.length)} note={qualified.length ? "Confirmed technical confluence" : "Patience is a position"} icon={Crosshair} accent /><Stat label="Bullish market breadth" value={setups.length ? `${Math.round(setups.filter(s => s.indicators["1d"].trend === "bullish").length / setups.length * 100)}%` : "—"} note="Daily trend across scanned assets" icon={Activity} /><Stat label="24h traded volume" value={setups.length ? dollars(setups.reduce((sum, s) => sum + s.quoteVolume24h, 0), true) : "—"} note="Across the scanned universe" icon={ArrowDownUp} /></div>
            {view === "overview" && setups.length > 0 && <><div className="section-heading"><div><h2>On the radar<span className="live-pill"><i />LATEST SCAN</span></h2><p>Qualified BUY plans first, then conditional WAIT candidates. Rejected assets remain in the full radar.</p></div><button className="text-button" onClick={() => navigate("radar")}>Explore all assets<ArrowRight size={17} /></button></div><div className="opportunity-grid">{setups.slice().sort(compareOpportunities).slice(0, 3).map((s, i) => <button className={cn("opportunity-card", i === 0 && "featured")} key={s.id} onClick={() => selectAsset(s.symbol)}><div className="opportunity-top"><div className="asset-pair"><CoinIcon asset={s.baseAsset} /><div><strong>{s.baseAsset}<span> / USDT</span></strong><span>{s.name}</span></div></div><ActionBadge action={s.action} /></div>{s.action === "NO TRADE" && <p className="opportunity-blocker">{setupBlockers(s)[0] || "Technical entry requirements are not met."}</p>}<div className="opportunity-price"><div><small className="live-price-label">Live price</small><strong>{dollars(freshQuotePrice(quotes[s.symbol], s.symbol, clock))}</strong><Change value={s.change24h} /></div><Sparkline values={s.sparkline} negative={s.change24h < 0} /></div><div className="opportunity-bottom"><span><i className="quality-indicator" />Setup quality <b>{s.score}<small>/100</small></b></span><span>{s.plan ? <>TP2 from entry <b className="positive">+{s.plan.targets[1]?.gainPct.toFixed(2)}%</b></> : <>Relative volume <b>{s.volume.relativeVolume.toFixed(2)}×</b></>}</span></div></button>)}</div></>}
          </>}
          {(view === "overview" || view === "workspace") && selected && <><div className="section-heading workspace-heading"><div><h2>Trade workspace<span className="subtle-badge">{selected.symbol}</span></h2><p>Price action, technical context, and a plan in one place.</p></div><label className="select-label">Asset<select aria-label="Chart asset" value={selected.symbol} onChange={e => setSymbol(e.target.value)}>{setups.map(s => <option value={s.symbol} key={s.id}>{s.baseAsset} / USDT</option>)}</select></label></div><div className="trading-layout"><section className="panel chart-panel"><div className="chart-heading"><div className="asset-pair"><CoinIcon asset={selected.baseAsset} small /><strong>{selected.baseAsset}<span> / USDT</span></strong><span className="chart-exchange">BINANCE</span></div><div className="chart-price"><div className="live-quote"><small>Live Binance price</small><strong data-testid="workspace-live-price">{dollars(selectedLivePrice)}</strong><small data-testid="workspace-quote-time">{selectedLivePrice !== null ? `Updated ${new Date(quotes[selected.symbol].asOf).toLocaleTimeString()}` : "Fresh quote unavailable"}</small></div></div></div><div className="research-reference">Research candle close: {dollars(selected.price)} · {timeframe.toUpperCase()} · {new Date(selected.asOf).toLocaleString()}</div><div className="chart-toolbar"><div className="segment">{(["1h", "4h", "1d"] as Timeframe[]).map(tf => <button key={tf} className={timeframe === tf ? "active" : ""} onClick={() => setTimeframe(tf)}>{tf.toUpperCase()}</button>)}</div><div className="chart-tools"><button title="Toggle EMA indicators" aria-pressed={showEma} className={showEma ? "active" : ""} onClick={() => setShowEma(!showEma)}><SlidersHorizontal size={16} />Indicators</button><button title="Toggle entry, stop and targets" aria-pressed={showLevels} className={showLevels ? "active" : ""} onClick={() => setShowLevels(!showLevels)}><Crosshair size={16} />Levels</button><button title="Toggle structure markers" aria-pressed={showStructure} className={showStructure ? "active" : ""} onClick={() => setShowStructure(!showStructure)}><Waves size={16} /><span>Structure</span></button></div></div><MarketChart key={`${selected.symbol}-${timeframe}-${refresh}`} setup={selected} timeframe={timeframe} refresh={refresh} showEma={showEma} showLevels={showLevels} showStructure={showStructure} /><div className="chart-legend"><span><i className="legend-gold" />EMA 21</span><span><i className="legend-purple" />EMA 50</span><span><i className="legend-blue" />Volume</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView <ArrowUpRight size={13} /></a></div><TimeframeAgreement setup={selected} /><TechnicalContext setup={selected} timeframe={timeframe} /></section><ResearchPanel setup={selected} capital={preferences.capital} risk={preferences.risk} onCapital={capital => setPreferences(p => ({ ...p, capital }))} onRisk={risk => setPreferences(p => ({ ...p, risk }))} onSimulate={simulate} notify={notify} disabled={stale || !paperStorageReady} /></div></>}
          {(view === "overview" || view === "radar") && <section className="panel radar-panel"><div className="panel-heading"><div><h2>{view === "overview" ? "Market watch" : "The opportunity universe"}</h2><p>{setups.length} assets · multi-timeframe analysis · ranked by eligibility and quality</p></div><button className={cn("watchlist-filter", onlyWatchlist && "active")} onClick={() => setOnlyWatchlist(!onlyWatchlist)}><Star size={17} fill={onlyWatchlist ? "currentColor" : "none"} />My watchlist</button></div><div className="radar-filters"><div className="local-search"><Search size={17} /><input aria-label="Filter assets" placeholder="Filter by asset or name…" value={search} onChange={e => setSearch(e.target.value)} /></div><label><ListFilter size={16} /><select aria-label="Filter signal action" value={actionFilter} onChange={e => setActionFilter(e.target.value)}><option value="all">All signals</option><option value="BUY">BUY setups</option><option value="WAIT">WAIT setups</option><option value="NO TRADE">No trade</option></select></label><label><select aria-label="Minimum setup score" value={minScore} onChange={e => setMinScore(Number(e.target.value))}><option value="0">Any quality</option><option value="60">Quality 60+</option><option value="70">Quality 70+</option><option value="80">Quality 80+</option></select></label><label><ArrowDownUp size={16} /><select aria-label="Sort markets" value={sort} onChange={e => setSort(e.target.value)}><option value="opportunity">BUY / WAIT first</option><option value="score">Technical score</option><option value="volume">24h volume</option><option value="change">24h change</option></select></label></div>{filtered.length ? <div className="table-scroll"><table className="data-table market-table"><thead><tr><th>Asset</th><th>Live price</th><th>24h change</th><th>24h volume</th><th>Recent trend</th><th>Setup quality</th><th>Signal</th><th /></tr></thead><tbody>{filtered.slice(0, view === "overview" ? 10 : 50).map(s => <tr key={s.id}><td><div className="table-asset"><button className={cn("star-button", watchlist.includes(s.symbol) && "saved")} aria-label={`${watchlist.includes(s.symbol) ? "Remove" : "Add"} ${s.baseAsset} ${watchlist.includes(s.symbol) ? "from" : "to"} watchlist`} onClick={() => toggleWatch(s.symbol)}><Star size={16} fill={watchlist.includes(s.symbol) ? "currentColor" : "none"} /></button><CoinIcon asset={s.baseAsset} small /><button className="asset-name" onClick={() => selectAsset(s.symbol)}><strong>{s.baseAsset}<span>USDT</span></strong><small>{s.name}</small></button></div></td><td className="numeric">{dollars(freshQuotePrice(quotes[s.symbol], s.symbol, clock))}</td><td className="numeric"><Change value={s.change24h} /></td><td className="numeric muted">{dollars(s.quoteVolume24h, true)}</td><td><Sparkline values={s.sparkline} negative={s.change24h < 0} /></td><td><div className="table-quality"><div><i style={{ width: `${s.score}%` }} /></div><strong>{s.score}<span>/100</span></strong></div></td><td><ActionBadge action={s.action} /></td><td><button className="table-open" aria-label={`Open ${s.baseAsset} trade workspace`} onClick={() => selectAsset(s.symbol)}><ArrowUpRight size={19} /></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><Search size={32} /><h3>{setups.length ? "No assets match these filters" : "No verified market data available"}</h3><p>{setups.length ? "Try a different quality threshold or remove a filter." : "The exchange must return valid closed candles before research can be generated."}</p><Button variant="outline" onClick={() => { setSearch(""); setMinScore(0); setActionFilter("all"); setOnlyWatchlist(false); }}>Reset filters</Button></div>}<div className="table-footer"><span>Prices refresh every 30s. 24h stats and setup scores are from the last recommendation scan. Quality is rule agreement, not win probability.</span>{view === "overview" && <button className="text-button" onClick={() => navigate("radar")}>View full radar<ArrowRight size={16} /></button>}</div></section>}
          {view === "liquidity" && <LiquidityView setups={setups} onSelect={selectAsset} />}
          {view === "volume" && selected && <><div className="view-asset-picker"><label>Analyzing<select value={selected.symbol} onChange={e => setSymbol(e.target.value)}>{setups.map(s => <option key={s.id} value={s.symbol}>{s.baseAsset} / USDT</option>)}</select></label></div><VolumeView setup={selected} key={selected.symbol} /></>}
          {view === "autopsy" && <HistoryView signals={data.signals} />}
          {view === "strategy" && <StrategyView report={data.analytics} />}
          {view === "paper" && <PaperView key={paper.initialCapital} account={paper} quotes={quotes} update={() => void updatePaper()} busy={paperBusy || !!paperAction} importAccount={importPortfolio} onManage={managePaper} onExplore={() => navigate("radar")} onCapital={setStartingCapital} onJournal={(index, value) => setPaper(current => ({ ...current, positions: current.positions.map((p, i) => i === index ? { ...p, journal: value } : p) }))} />}
          {view === "alerts" && <AlertsView alerts={data.alerts} seen={seen} onRead={readAlerts} onEnable={enableNotifications} enabled={notifications} />}
          {view === "settings" && <section className="panel settings-panel"><div className="panel-heading"><h2>Research preferences</h2><span className="micro-tag">SAVED ON THIS DEVICE</span></div><div className="settings-fields"><label>Research capital (USDT)<input type="number" value={preferences.capital} min="100" max="1000000000" onChange={e => setPreferences(p => ({ ...p, capital: Number(e.target.value) }))} /><small>Used for research position sizing. Virtual portfolio cash is tracked separately.</small></label><label>Risk per trade (%)<input type="number" value={preferences.risk} min="0.1" max="5" step="0.1" onChange={e => setPreferences(p => ({ ...p, risk: Number(e.target.value) }))} /><small>0.1%–5% of capital, including planned transaction costs.</small></label><label>Manual scanner universe<select value={preferences.universe} onChange={e => setPreferences(p => ({ ...p, universe: Number(e.target.value) }))}><option value="20">20 liquid assets</option><option value="30">30 liquid assets</option><option value="40">40 liquid assets</option><option value="50">50 liquid assets</option></select><small>Automatic ranking uses Binance USDT spot volume.</small></label><label className="checkbox-label"><input type="checkbox" checked={preferences.useWatchlist} onChange={e => setPreferences(p => ({ ...p, useWatchlist: e.target.checked }))} /><span>Scan my watchlist during manual scans<small>{watchlist.length} saved assets. Empty watchlists use the automatic universe.</small></span></label><label className="checkbox-label"><input type="checkbox" checked={preferences.largeText} onChange={e => setPreferences(p => ({ ...p, largeText: e.target.checked }))} /><span>Extra-large interface text<small>Increase interface type for easier reading.</small></span></label></div><div className="settings-info"><ShieldCheck size={23} /><div><strong>Transparent by default</strong><p>Persistent publisher: {data.persistence}. Recommendation scans run from GitHub Actions every {SCAN_CADENCE}. Live prices refresh every 30 seconds and closed candles every minute while this page is visible. The terminal never requests an exchange key and has no real order endpoint. The optional Grok CLI only narrates already calculated qualified plans.</p><a href="https://github.com/fareza777/website-intel-x" target="_blank" rel="noreferrer">View source & deployment guide <ArrowUpRight size={15} /></a></div></div></section>}
        </>}
        <footer className="main-footer"><span><ShieldCheck size={15} />Research with discipline. Spot only. No leverage. No real orders.</span><span>CryptoIntel X <span className="footer-separator">/</span> Independent of AI</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={19} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={17} /></button></div>}
    <Dialog open={watchlistOpen} onOpenChange={setWatchlistOpen}><DialogContent><DialogTitle className="dialog-title"><Star size={24} />Your market watchlist</DialogTitle><DialogDescription className="dialog-description">Track up to 50 Binance USDT spot markets. Use the watchlist filter or enable watchlist scanning in settings.</DialogDescription><label className="dialog-label">Assets<textarea className="watchlist-input" rows={4} placeholder="BTC, ETH, SOL, BNB, LINK" value={watchText} onChange={e => setWatchText(e.target.value)} /></label><p className="muted">{watchlist.length} currently saved · separate assets with commas</p><Button className="dialog-save" onClick={saveWatchlist}><Plus />Save watchlist</Button></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogTitle className="dialog-title"><FlaskConical size={24} />Built on evidence.</DialogTitle><DialogDescription className="dialog-description">CryptoIntel X turns real Binance spot data into deterministic research. No LLM chooses prices or places trades.</DialogDescription><div className="methodology"><h3>Closed candles, clear rules</h3><p>EMA, Wilder RSI and ATR, MACD, volume, and confirmed market structure are evaluated on 1H, 4H, and 1D data. Incomplete bars never qualify a setup.</p><h3>A score is not a probability</h3><p>Setup quality measures agreement among technical rules. It does not predict the chance of winning. Weak markets are allowed to produce no trade.</p><h3>Outcomes you can audit</h3><p>Published BUY and conditional WAIT plans remain unchanged. Simulation uses future closed bars, costs on both sides, stop-first ambiguous fills, and no same-entry-bar target credit. TP1/TP2 are milestones; the full exit is TP3, stop, or the selected horizon holding limit.</p><h3>Know the limitations</h3><p>SMC events are heuristic, candle profiles approximate volume at price, and historical strategy samples may be small. Browser alerts and local paper simulations need the terminal open or a manual refresh.</p><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright © 2025 TradingView, Inc.</a></div></DialogContent></Dialog>
  </div>;
}
function Stat({ label, value, note, icon: Icon, accent = false }: { label: string; value: string; note: string; icon: ElementType; accent?: boolean }) { return <div className={cn("stat-card", accent && "accent-stat")}><span>{label}<Icon size={19} /></span><strong>{value}{accent && <span className="stat-suffix">opportunities</span>}</strong><p>{note}</p></div>; }
