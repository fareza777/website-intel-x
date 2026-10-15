"use client";
import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";
import { Activity, LoaderCircle, RefreshCw } from "lucide-react";
import type { Candle, MarketSetup, Timeframe } from "@/lib/types";
import { decimalPlaces, price } from "@/lib/utils";
import { CANDLE_REFRESH_MS } from "@/lib/live-market";
import { Button } from "./ui/button";

export function Sparkline({ values, negative = false }: { values: number[]; negative?: boolean }) {
  if (values.length < 2) return <span className="spark-empty">No price history</span>;
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const points = values.map((n, i) => `${i / (values.length - 1) * 160},${43 - (n - min) / range * 36}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 160 48" aria-label="Recent closed price history" role="img"><polyline points={points} fill="none" stroke={negative ? "#df748a" : "#74a5ff"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
function emaPoints(candles: Candle[], period: number) {
  if (candles.length < period) return [];
  let value = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  const result = [{ time: (candles[period - 1].time / 1000) as UTCTimestamp, value }];
  for (let i = period; i < candles.length; i++) { value += 2 / (period + 1) * (candles[i].close - value); result.push({ time: (candles[i].time / 1000) as UTCTimestamp, value }); }
  return result;
}
export function MarketChart({ setup, timeframe, refresh, showLevels = true, showEma = true, showStructure = false }: { setup: MarketSetup; timeframe: Timeframe; refresh: number; showLevels?: boolean; showEma?: boolean; showStructure?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function loadCandles() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/candles?symbol=${setup.symbol}&interval=${timeframe}&limit=300`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.candles?.length) throw new Error(data.error || "Closed candle data is unavailable.");
        if (controller.signal.aborted) return;
        setCandles(previous => JSON.stringify(previous) === JSON.stringify(data.candles) ? previous : data.candles);
        setError("");
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Candle refresh unavailable.");
      } finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void loadCandles();
    const interval = setInterval(() => { if (document.visibilityState === "visible") void loadCandles(); }, CANDLE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void loadCandles(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [setup.symbol, timeframe, refresh, retry]);
  useEffect(() => {
    if (!container.current || !candles.length || loading) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#11141c" }, textColor: "#919bae", fontSize: 14, fontFamily: "'Segoe UI', Arial, sans-serif", attributionLogo: true, panes: { separatorColor: "#232938", separatorHoverColor: "#3a4865", enableResize: true } },
      grid: { vertLines: { color: "#1a202c" }, horzLines: { color: "#1e2430" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#65728a", labelBackgroundColor: "#384660" }, horzLine: { color: "#65728a", labelBackgroundColor: "#384660" } },
      rightPriceScale: { borderColor: "#252b38", scaleMargins: { top: .08, bottom: .08 } },
      timeScale: { borderColor: "#252b38", timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 8 },
      handleScroll: true, handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: "#6e9eff", downColor: "#de748a", borderUpColor: "#6e9eff", borderDownColor: "#de748a", wickUpColor: "#6e9eff", wickDownColor: "#de748a", priceLineColor: "#799ef0", priceFormat: { type: "price", precision: decimalPlaces(setup.tickSize ?? setup.plan?.tickSize ?? .00000001), minMove: setup.tickSize ?? setup.plan?.tickSize ?? .00000001 } });
    series.setData(candles.map(c => ({ time: (c.time / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    volume.setData(candles.map(c => ({ time: (c.time / 1000) as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#385282" : "#69414f" })));
    chart.panes()[1]?.setHeight(90);
    if (showEma) {
      const fast = chart.addSeries(LineSeries, { color: "#d4ad72", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      fast.setData(emaPoints(candles, 21));
      const slow = chart.addSeries(LineSeries, { color: "#8c83c8", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      slow.setData(emaPoints(candles, 50));
    }
    if (showLevels && setup.plan) {
      const plan = setup.plan;
      series.createPriceLine({ price: plan.entry, color: "#80aaff", lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "ENTRY" });
      series.createPriceLine({ price: plan.stopLoss, color: "#de748a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "STOP" });
      plan.targets.forEach((target, i) => series.createPriceLine({ price: target.price, color: "#9db6e9", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `TP${i + 1}` }));
    }
    if (showStructure) {
      const times = new Set(candles.map(c => c.time / 1000));
      const intervalMs = timeframe === "1h" ? 3_600_000 : timeframe === "4h" ? 14_400_000 : 86_400_000;
      const markers = setup.structure.map(e => ({ ...e, markerTime: Math.floor(e.time / intervalMs) * intervalMs / 1000 })).filter(e => times.has(e.markerTime));
      createSeriesMarkers(series, markers.slice(-12).sort((a, b) => a.markerTime - b.markerTime).map(e => ({ time: e.markerTime as UTCTimestamp, position: e.direction === "bullish" ? "belowBar" as const : "aboveBar" as const, color: e.direction === "bullish" ? "#a1bbff" : "#e593a4", shape: e.direction === "bullish" ? "arrowUp" as const : "arrowDown" as const, text: e.type })));
    }
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 8 });
    return () => chart.remove();
  }, [candles, loading, setup, showEma, showLevels, showStructure, timeframe]);
  const last = candles.at(-1);
  return <div className="chart-wrap">
    <div className="chart-ohlc">{last && !loading ? <><span>O <b>{price(last.open)}</b></span><span>H <b>{price(last.high)}</b></span><span>L <b>{price(last.low)}</b></span><span>C <b>{price(last.close)}</b></span><span className="closed-label">Closed candles</span></> : <span>Binance spot · {timeframe.toUpperCase()} · closed candles</span>}</div>
    <div className="chart-canvas" ref={container} />
    {(loading || (error && !candles.length)) && <div className="chart-state">{loading ? <><LoaderCircle className="spin" size={28} /><p>Loading real market data</p></> : <><Activity size={28} /><p>{error}</p><Button variant="outline" onClick={() => { setLoading(true); setError(""); setRetry(v => v + 1); }}><RefreshCw /> Retry data</Button></>}</div>}
    {!loading && candles.length > 0 && <div className={error ? "chart-refresh-note unavailable" : "chart-refresh-note"}>{error ? "Candle refresh unavailable · displaying the last received history" : "Checks for closed candles every minute"} · Last close {new Date(last!.closeTime).toLocaleString()}</div>}
  </div>;
}
