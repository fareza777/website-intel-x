"use client";
import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { chartSettingsSchema, DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/lib/chart-studies";
import { Button } from "./ui/button";

export function ChartSettingsPanel({ value, onApply, onClose }: { value: ChartSettings; onApply: (next: ChartSettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  function set<K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function number(key: keyof ChartSettings, label: string, min = 2, max = 200, step = 1) {
    return <label className="study-number">{label}<input type="number" min={min} max={max} step={step} required value={Number.isNaN(Number(draft[key])) ? "" : String(draft[key])} onChange={e => setDraft(current => ({ ...current, [key]: e.target.value === "" ? NaN : Number(e.target.value) }))} /></label>;
  }
  function toggle(key: keyof ChartSettings, label: string, hint: string) {
    return <label className="study-setting-toggle"><input type="checkbox" checked={Boolean(draft[key])} onChange={e => setDraft(current => ({ ...current, [key]: e.target.checked }))} /><span><strong>{label}</strong><small>{hint}</small></span></label>;
  }
  return <form className="chart-settings-panel" aria-label="Chart indicator settings" onSubmit={event => {
    event.preventDefault(); const parsed = chartSettingsSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the indicator periods."); return; }
    onApply(parsed.data); onClose();
  }}>
    <div className="chart-settings-heading"><div><span className="eyebrow">CHART STUDIO</span><h3>Set up your market view.</h3><p>Saved on this device. Chart settings do not change scanner rules or recommendations.</p></div><button type="button" className="icon-button" aria-label="Close chart settings" onClick={onClose}><X size={21} /></button></div>
    <div className="chart-settings-grid">
      <fieldset><legend>Price overlays</legend>
        {toggle("ema", "Exponential Moving Average", "Three trend lines that give greater weight to recent prices.")}
        <div className="study-parameters">{number("emaFast", "Fast EMA")}{number("emaSlow", "Middle EMA")}{number("emaLong", "Long EMA")}</div>
        {toggle("sma", "Simple Moving Average", "An equally weighted average of closing prices.")}{number("smaPeriod", "SMA period")}
        {toggle("bollinger", "Bollinger Bands", "SMA plus or minus standard deviations to show price dispersion.")}
        <div className="study-parameters">{number("bbPeriod", "BB period")}{number("bbMultiplier", "Deviations", .5, 4, .1)}</div>
        {toggle("vwap", "Session VWAP", "Quote volume / base volume; resets at 00:00 UTC.")}
        {toggle("donchian", "Donchian Channel", "High/low of the prior N candles; excludes the current candle.")}{number("donchianPeriod", "Donchian lookback")}
      </fieldset>
      <fieldset><legend>Momentum & volume panes</legend>
        {toggle("volume", "Volume", "Actual Binance traded base volume per candle.")}
        {toggle("rsi", "Relative Strength Index", "Wilder RSI with reference levels at 30, 50, and 70.")}{number("rsiPeriod", "RSI period")}
        {toggle("macd", "MACD", "Fast EMA minus slow EMA, with signal line and histogram.")}
        <div className="study-parameters">{number("macdFast", "MACD fast")}{number("macdSlow", "MACD slow")}{number("macdSignal", "Signal")}</div>
        {toggle("atr", "Average True Range", "Volatility in price units; does not indicate direction.")}{number("atrPeriod", "ATR period")}
        {toggle("levels", "Recommendation levels", "Original entry, stop, and targets; shown only for valid research plans.")}
        {toggle("structure", "Market structure", "Confirmed BOS, CHoCH, FVG, and liquidity sweeps.")}
      </fieldset>
      <fieldset className="chart-appearance"><legend>Appearance</legend>
        <label>Chart type<select value={draft.style} onChange={e => set("style", e.target.value as ChartSettings["style"])}><option value="candles">Candlestick</option><option value="line">Line</option><option value="area">Area</option></select></label>
        <label>Price scale<select value={draft.scale} onChange={e => set("scale", e.target.value as ChartSettings["scale"])}><option value="price">Price</option><option value="log">Logarithmic</option><option value="percent">Percentage from first visible value</option></select></label>
        {toggle("grid", "Grid", "Horizontal and vertical guide lines.")}{toggle("magnet", "Crosshair magnet", "Snap the crosshair to the nearest series value.")}
      </fieldset>
    </div>
    {error && <p role="alert" className="chart-setting-error">{error}</p>}
    <div className="chart-settings-actions"><button type="button" className="text-button" onClick={() => { setDraft({ ...DEFAULT_CHART_SETTINGS }); setError(""); }}><RotateCcw size={17} />Restore defaults</button><Button type="submit"><Check size={17} />Apply</Button></div>
  </form>;
}
