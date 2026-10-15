"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle, PriceScaleMode, createChart, createSeriesMarkers, type IChartApi, type MouseEventParams, type UTCTimestamp } from "lightweight-charts";
import { Activity, ChevronLeft, ChevronRight, Expand, LoaderCircle, Minus, Plus, RefreshCw, RotateCcw, Settings2, Shrink } from "lucide-react";
import type { Candle, MarketSetup, Timeframe } from "@/lib/types";
import { cn, decimalPlaces, percent, price } from "@/lib/utils";
import { CANDLE_REFRESH_MS } from "@/lib/live-market";
import { buildChartStudies, candleMetrics, chartPreset, readChartSettings, STUDY_LABELS, type ChartSettings } from "@/lib/chart-studies";
import { ChartSettingsPanel } from "./chart-settings";
import { Button } from "./ui/button";

const STORAGE = "cix-chart-studio-v1";
const CHANGE_EVENT = "cix-chart-studio-change";
function subscribeSettings(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}
function storedSettings() { try { return localStorage.getItem(STORAGE); } catch { return null; } }
const serverSettings = () => null;
const intervalMs = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
type Cursor = { time: number; x: number } | null;

export function MarketChart({ setup, timeframe, refresh }: { setup: MarketSetup; timeframe: Timeframe; refresh: number }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const crosshairRef = useRef<((candle: Candle) => void) | null>(null);
  const viewport = useRef<{ from: number; to: number; first: number; count: number } | null>(null);
  const raw = useSyncExternalStore(subscribeSettings, storedSettings, serverSettings);
  const saved = useMemo(() => readChartSettings(raw), [raw]);
  const [temporarySettings, setTemporarySettings] = useState<ChartSettings | null>(null);
  const config = temporarySettings ?? saved;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [receivedAt, setReceivedAt] = useState(0);
  const studies = useMemo(() => buildChartStudies(candles, config), [candles, config]);
  function saveSettings(next: ChartSettings) {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setTemporarySettings(null); setStorageError(""); window.dispatchEvent(new Event(CHANGE_EVENT)); }
    catch { setTemporarySettings(next); setStorageError("Penyimpanan browser tidak tersedia. Pengaturan berlaku selama sesi ini."); }
  }
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [expanded]);
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    async function loadCandles() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/candles?symbol=${setup.symbol}&interval=${timeframe}&limit=500`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.candles?.length) throw new Error(data.error || "Closed candle data is unavailable.");
        if (controller.signal.aborted) return;
        setCandles(previous => JSON.stringify(previous) === JSON.stringify(data.candles) ? previous : data.candles);
        setReceivedAt(Date.now()); setError("");
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Candle refresh unavailable."); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void loadCandles();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadCandles(); }, CANDLE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void loadCandles(); };
    document.addEventListener("visibilitychange", onVisible); window.addEventListener("focus", onVisible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [setup.symbol, timeframe, refresh, retry]);

  useEffect(() => {
    if (!container.current || !candles.length || loading) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#101722" }, textColor: "#a4b4cc", fontSize: 14, fontFamily: "'Segoe UI', Arial, sans-serif", attributionLogo: true, panes: { separatorColor: "#33435b", separatorHoverColor: "#6788ba", enableResize: true } },
      grid: { vertLines: { color: "#26334770", visible: config.grid }, horzLines: { color: "#26334770", visible: config.grid } },
      crosshair: { mode: config.magnet ? CrosshairMode.Magnet : CrosshairMode.Normal, vertLine: { color: "#96b4df", labelBackgroundColor: "#345782" }, horzLine: { color: "#96b4df", labelBackgroundColor: "#345782" } },
      rightPriceScale: { borderColor: "#33435b", scaleMargins: { top: .12, bottom: .1 } },
      timeScale: { borderColor: "#33435b", timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 9, fixLeftEdge: true },
      handleScroll: true, handleScale: true,
      localization: { locale: "id-ID" },
    });
    chartRef.current = chart;
    const tick = setup.tickSize ?? setup.plan?.tickSize ?? .00000001;
    const priceFormat = { type: "price" as const, precision: decimalPlaces(tick), minMove: tick };
    const series = config.style === "candles" ? chart.addSeries(CandlestickSeries, {
      upColor: "#79aaff", downColor: "#ee829a", borderUpColor: "#79aaff", borderDownColor: "#ee829a", wickUpColor: "#9bbfff", wickDownColor: "#f29daf", priceLineColor: "#89b6ff", priceFormat,
    }) : config.style === "line" ? chart.addSeries(LineSeries, { color: "#8fbaff", lineWidth: 2, priceFormat })
      : chart.addSeries(AreaSeries, { lineColor: "#8fbaff", topColor: "#578bda44", bottomColor: "#578bda03", lineWidth: 2, priceFormat });
    series.setData(candles.map(c => ({ time: c.time / 1000 as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close, value: c.close })));
    series.priceScale().applyOptions({ mode: config.scale === "log" ? PriceScaleMode.Logarithmic : config.scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal });
    function line(values: (number | null)[], color: string, title: string, pane = 0, oscillator = false) {
      const s = chart.addSeries(LineSeries, { color, title, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true,
        priceFormat: oscillator ? { type: "price", precision: 2, minMove: .01 } : priceFormat }, pane);
      s.setData(values.flatMap((value, i) => value === null ? [] : [{ time: candles[i].time / 1000 as UTCTimestamp, value }])); return s;
    }
    if (config.ema) { line(studies.emaFast, "#e3b875", `EMA ${config.emaFast}`); line(studies.emaSlow, "#b6a6f0", `EMA ${config.emaSlow}`); line(studies.emaLong, "#9aaabd", `EMA ${config.emaLong}`); }
    if (config.sma) line(studies.sma, "#f1d6a0", `SMA ${config.smaPeriod}`);
    if (config.bollinger) { line(studies.bbUpper, "#ad99d0", "BB upper"); line(studies.bbMiddle, "#796e96", "BB mid"); line(studies.bbLower, "#ad99d0", "BB lower"); }
    if (config.vwap) line(studies.vwap, "#ecb397", "UTC VWAP");
    if (config.donchian) { line(studies.donchianUpper, "#6b9ba9", "Prior high"); line(studies.donchianLower, "#6b9ba9", "Prior low"); }
    let pane = 0;
    if (config.volume) {
      pane++; const volume = chart.addSeries(HistogramSeries, { title: "Volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, pane);
      volume.setData(candles.map(c => ({ time: c.time / 1000 as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#426ba9" : "#98536a" })));
      chart.panes()[pane]?.setStretchFactor(.8);
    }
    if (config.rsi) {
      pane++; const strength = line(studies.rsi, "#c0acf2", `RSI ${config.rsiPeriod}`, pane, true);
      strength.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      [30, 50, 70].forEach(value => strength.createPriceLine({ price: value, color: value === 50 ? "#4d5769" : "#74688f", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: String(value) }));
      chart.panes()[pane]?.setStretchFactor(1);
    }
    if (config.macd) {
      pane++; const histogram = chart.addSeries(HistogramSeries, { title: "MACD histogram", priceLineVisible: false, lastValueVisible: false, priceFormat }, pane);
      histogram.setData(studies.macdHistogram.flatMap((value, i) => value === null ? [] : [{ time: candles[i].time / 1000 as UTCTimestamp, value, color: value >= 0 ? "#507cb8" : "#ad617a" }]));
      line(studies.macdLine, "#8ab6ff", "MACD", pane); line(studies.macdSignal, "#e4b77f", "Signal", pane); chart.panes()[pane]?.setStretchFactor(1);
    }
    if (config.atr) { pane++; line(studies.atr, "#e5bd83", `ATR ${config.atrPeriod}`, pane); chart.panes()[pane]?.setStretchFactor(.9); }
    chart.panes()[0]?.setStretchFactor(4);
    if (config.levels && setup.plan) {
      const plan = setup.plan;
      series.createPriceLine({ price: plan.entry, color: "#8fbaff", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: setup.action === "WAIT" ? "ENTRY · WAIT" : "ENTRY" });
      series.createPriceLine({ price: plan.stopLoss, color: "#ee829a", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "STOP" });
      plan.targets.forEach((target, i) => series.createPriceLine({ price: target.price, color: "#b7c9ee", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `TP${i + 1}` }));
    }
    if (config.structure) {
      const times = new Set(candles.map(c => c.time / 1000));
      const markers = setup.structure.map(e => ({ ...e, markerTime: Math.floor(e.time / intervalMs[timeframe]) * intervalMs[timeframe] / 1000 })).filter(e => times.has(e.markerTime));
      createSeriesMarkers(series, markers.slice(-16).sort((a, b) => a.markerTime - b.markerTime).map(e => ({ time: e.markerTime as UTCTimestamp, position: e.direction === "bullish" ? "belowBar" as const : "aboveBar" as const, color: e.direction === "bullish" ? "#c0d7ff" : "#ffafc1", shape: e.direction === "bullish" ? "arrowUp" as const : "arrowDown" as const, text: e.type })));
    }
    const byTime = new Set(candles.map(c => c.time));
    const move = (event: MouseEventParams) => {
      const time = typeof event.time === "number" ? event.time * 1000 : NaN;
      if (!byTime.has(time) || !event.point || event.point.x < 0 || event.point.y < 0) { setCursor(null); return; }
      setCursor({ time, x: Math.max(8, Math.min(event.point.x + 18, (container.current?.clientWidth ?? 600) - 260)) });
    };
    chart.subscribeCrosshairMove(move); chart.subscribeClick(move);
    crosshairRef.current = candle => chart.setCrosshairPosition(candle.close, candle.time / 1000 as UTCTimestamp, series);
    const previous = viewport.current;
    if (previous) {
      const shift = (candles[0].time - previous.first) / intervalMs[timeframe];
      const following = previous.to >= previous.count - 1;
      const to = following ? candles.length + 8 : previous.to - shift;
      chart.timeScale().setVisibleLogicalRange({ from: following ? to - (previous.to - previous.from) : previous.from - shift, to });
    } else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 8 });
    return () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) viewport.current = { from: range.from, to: range.to, first: candles[0].time, count: candles.length };
      chart.unsubscribeCrosshairMove(move); chart.unsubscribeClick(move); chart.remove(); chartRef.current = null; crosshairRef.current = null;
    };
  }, [candles, config, loading, setup, studies, timeframe]);

  const index = cursor ? candles.findIndex(c => c.time === cursor.time) : candles.length - 1;
  const selected = candles[index >= 0 ? index : candles.length - 1];
  const metrics = selected ? candleMetrics(selected, candles[index - 1]) : null;
  const last = candles.at(-1);
  const studyPrecision = Math.min(8, Math.max(2, decimalPlaces(setup.tickSize ?? setup.plan?.tickSize ?? .00000001) + 1));
  const studyPrice = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: studyPrecision });
  const stale = !!last && receivedAt - last.closeTime > intervalMs[timeframe] * 2;
  const panes = [config.volume, config.rsi, config.macd, config.atr].filter(Boolean).length;
  const height = (expanded ? 500 : 360) + panes * 105;
  function range(count: number | "all") { chartRef.current?.timeScale().setVisibleLogicalRange({ from: count === "all" ? 0 : Math.max(0, candles.length - count), to: candles.length + 8 }); }
  function zoom(factor: number) { const scale = chartRef.current?.timeScale(); const current = scale?.getVisibleLogicalRange(); if (current) { const width = Math.max(15, Math.min(candles.length + 50, (current.to - current.from) * factor)); scale!.setVisibleLogicalRange({ from: current.to - width, to: current.to }); } }
  function selectBar(nextIndex: number) { const candle = candles[nextIndex]; if (candle) { setCursor({ time: candle.time, x: 12 }); crosshairRef.current?.(candle); } }
  return <div className={cn("chart-studio", expanded && "chart-expanded")}>
    <div className="chart-command-bar"><div className="chart-studio-title"><Activity size={18} /><strong>Chart Studio</strong><span>{timeframe.toUpperCase()} · Binance spot</span></div><div className="chart-command-actions">
      <select aria-label="Preset indikator" value="" onChange={e => saveSettings(chartPreset(e.target.value as "trend" | "momentum" | "volatility" | "clean", config))}><option value="" disabled>Preset indikator</option><option value="trend">Trend & breakout</option><option value="momentum">Momentum</option><option value="volatility">Volatilitas</option><option value="clean">Chart bersih</option></select>
      <button className={cn("chart-command", settingsOpen && "active")} aria-label="Pengaturan indikator" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={18} /><span>Indikator & tampilan</span></button>
      <button className="chart-command" aria-label={expanded ? "Kecilkan chart" : "Perluas chart"} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <Shrink size={18} /> : <Expand size={18} />}</button>
    </div></div>
    {settingsOpen && <ChartSettingsPanel key={raw} value={config} onApply={saveSettings} onClose={() => setSettingsOpen(false)} />}
    <div className="study-chips" aria-label="Indikator aktif">{STUDY_LABELS.map(study => <button key={study.key} className={config[study.key] ? "active" : ""} aria-pressed={config[study.key]} onClick={() => saveSettings({ ...config, [study.key]: !config[study.key] })}>{study.label}<span>{config[study.key] ? "ON" : "+"}</span></button>)}</div>
    {storageError && <p className="chart-refresh-note unavailable">{storageError}</p>}
    <div className="candle-inspector" aria-label="Detail candle terpilih">
      <div className="candle-inspector-heading"><div><span className="eyebrow">{cursor ? "CANDLE TERPILIH" : "CANDLE TERAKHIR"}</span><strong>{selected ? new Date(selected.time).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "Menunggu data Binance"}</strong></div><div className="candle-nav"><button aria-label="Candle sebelumnya" disabled={index <= 0} onClick={() => selectBar(index - 1)}><ChevronLeft size={18} /></button><span>{selected ? `${index + 1}/${candles.length}` : "—"}</span><button aria-label="Candle berikutnya" disabled={!cursor || index >= candles.length - 1} onClick={() => selectBar(index + 1)}><ChevronRight size={18} /></button></div></div>
      <div className="candle-price-grid">{(["open", "high", "low", "close"] as const).map((field, i) => <div key={field}><span>{["Open", "High", "Low", "Close"][i]}</span><strong>{selected ? price(selected[field]) : "—"}</strong></div>)}<div><span>Volume</span><strong>{selected ? price(selected.volume, true) : "—"}</strong></div></div>
      <div className="candle-percent-grid"><div><span>Perubahan open → close</span><strong data-testid="candle-body-percent" className={metrics && metrics.bodyPct < 0 ? "negative" : "positive"}>{percent(metrics?.bodyPct)}</strong></div><div><span>Range high − low / open</span><strong data-testid="candle-range-percent">{metrics ? `${metrics.rangePct.toFixed(2)}%` : "—"}</strong></div><div><span>Dari close sebelumnya</span><strong className={metrics?.previousClosePct != null && metrics.previousClosePct < 0 ? "negative" : "positive"}>{percent(metrics?.previousClosePct)}</strong></div></div>
    </div>
    <div className="chart-canvas-wrapper" style={{ height }}>
      <div className="chart-canvas advanced-canvas" ref={container} data-testid="advanced-chart-canvas" />
      {cursor && metrics && <div className="candle-hover-tooltip" role="status" style={{ left: cursor.x }}><span>{new Date(selected.time).toLocaleString("id-ID", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {timeframe.toUpperCase()}</span><strong className={metrics.bodyPct < 0 ? "negative" : "positive"}>{percent(metrics.bodyPct)}<small>open → close</small></strong><div><span>Range <b>{metrics.rangePct.toFixed(2)}%</b></span><span>Volume <b>{price(selected.volume, true)}</b></span></div></div>}
      {(loading || (error && !candles.length)) && <div className="chart-state">{loading ? <><LoaderCircle className="spin" size={28} /><p>Memuat candle Binance…</p></> : <><Activity size={28} /><p>{error}</p><Button variant="outline" onClick={() => { setLoading(true); setError(""); setRetry(v => v + 1); }}><RefreshCw />Coba lagi</Button></>}</div>}
    </div>
    <div className="chart-navigation-bar"><div className="chart-ranges">{[50, 100, 200, "all"].map(count => <button key={count} onClick={() => range(count as number | "all")}>{count === "all" ? "Semua" : `${count} bar`}</button>)}</div><div className="chart-zoom"><button aria-label="Zoom out chart" onClick={() => zoom(1.3)}><Minus size={18} /></button><button aria-label="Zoom in chart" onClick={() => zoom(.75)}><Plus size={18} /></button><button aria-label="Reset tampilan chart" onClick={() => range(90)}><RotateCcw size={17} /></button></div></div>
    <div className="study-readout">{config.ema && <span>EMA {config.emaFast} <b>{studyPrice(studies.emaFast[index])}</b> · {config.emaSlow} <b>{studyPrice(studies.emaSlow[index])}</b> · {config.emaLong} <b>{studyPrice(studies.emaLong[index])}</b></span>}{config.rsi && <span>RSI {config.rsiPeriod} <b>{studies.rsi[index]?.toFixed(2) ?? "—"}</b></span>}{config.macd && <span>MACD <b>{studyPrice(studies.macdLine[index])}</b> · signal <b>{studyPrice(studies.macdSignal[index])}</b></span>}{config.atr && <span>ATR {config.atrPeriod} <b>{studyPrice(studies.atr[index])}</b></span>}{config.vwap && <span>UTC VWAP <b>{studyPrice(studies.vwap[index])}</b></span>}</div>
    <p className={cn("chart-refresh-note", (error || stale) && "unavailable")}>{error ? "Refresh gagal · menampilkan histori terakhir yang diterima" : stale ? "Histori candle sudah kedaluwarsa" : "Candle tertutup · refresh setiap menit"}{last && ` · Close terakhir ${new Date(last.closeTime).toLocaleString("id-ID")}`}</p>
    <p className="chart-instruction">Arahkan kursor atau tap candle untuk detail persentase. Geser untuk menelusuri; scroll atau pinch untuk zoom. Studi chart memakai histori yang ditampilkan, sedangkan skor rekomendasi dibekukan pada waktu scan.</p>
    {config.scale === "percent" && <p className="chart-refresh-note">Skala % memakai nilai pertama yang terlihat sebagai 0%; acuannya mengikuti pan/zoom. Gunakan harga biasa/log untuk membandingkan level harga dan overlay.</p>}
  </div>;
}
