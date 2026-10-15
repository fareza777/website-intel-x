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
  return <form className="chart-settings-panel" aria-label="Pengaturan indikator chart" onSubmit={event => {
    event.preventDefault(); const parsed = chartSettingsSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Periksa periode indikator."); return; }
    onApply(parsed.data); onClose();
  }}>
    <div className="chart-settings-heading"><div><span className="eyebrow">CHART STUDIO</span><h3>Atur cara Anda membaca pasar.</h3><p>Disimpan di perangkat ini. Parameter chart tidak mengubah aturan atau rekomendasi scanner.</p></div><button type="button" className="icon-button" aria-label="Tutup pengaturan chart" onClick={onClose}><X size={21} /></button></div>
    <div className="chart-settings-grid">
      <fieldset><legend>Overlay harga</legend>
        {toggle("ema", "Exponential Moving Average", "Tiga garis tren; respons lebih besar pada harga terbaru.")}
        <div className="study-parameters">{number("emaFast", "EMA cepat")}{number("emaSlow", "EMA tengah")}{number("emaLong", "EMA panjang")}</div>
        {toggle("sma", "Simple Moving Average", "Rata-rata penutupan dengan bobot yang sama.")}{number("smaPeriod", "Periode SMA")}
        {toggle("bollinger", "Bollinger Bands", "SMA ± deviasi standar; mengamati penyebaran harga.")}
        <div className="study-parameters">{number("bbPeriod", "Periode BB")}{number("bbMultiplier", "Deviasi", .5, 4, .1)}</div>
        {toggle("vwap", "Session VWAP", "Quote volume ÷ base volume; reset setiap 00:00 UTC.")}
        {toggle("donchian", "Donchian Channel", "High/low N candle sebelumnya; candle saat ini dikecualikan.")}{number("donchianPeriod", "Lookback Donchian")}
      </fieldset>
      <fieldset><legend>Panel momentum & volume</legend>
        {toggle("volume", "Volume", "Volume transaksi nyata per candle dari Binance.")}
        {toggle("rsi", "Relative Strength Index", "Wilder RSI; garis referensi 30, 50 dan 70.")}{number("rsiPeriod", "Periode RSI")}
        {toggle("macd", "MACD", "EMA cepat − EMA lambat, garis signal dan histogram.")}
        <div className="study-parameters">{number("macdFast", "MACD fast")}{number("macdSlow", "MACD slow")}{number("macdSignal", "Signal")}</div>
        {toggle("atr", "Average True Range", "Volatilitas dalam satuan harga; bukan arah pergerakan.")}{number("atrPeriod", "Periode ATR")}
        {toggle("levels", "Level rekomendasi", "Entry, stop dan TP asli; hanya muncul jika ada rencana valid.")}
        {toggle("structure", "Struktur pasar", "BOS, CHoCH, FVG dan sweep yang sudah dikonfirmasi.")}
      </fieldset>
      <fieldset className="chart-appearance"><legend>Tampilan</legend>
        <label>Jenis chart<select value={draft.style} onChange={e => set("style", e.target.value as ChartSettings["style"])}><option value="candles">Candlestick</option><option value="line">Line</option><option value="area">Area</option></select></label>
        <label>Skala harga<select value={draft.scale} onChange={e => set("scale", e.target.value as ChartSettings["scale"])}><option value="price">Harga biasa</option><option value="log">Logaritmik</option><option value="percent">Persentase dari bar pertama</option></select></label>
        {toggle("grid", "Grid", "Garis bantu horizontal dan vertikal.")}{toggle("magnet", "Crosshair magnet", "Kursor menempel ke nilai seri terdekat.")}
      </fieldset>
    </div>
    {error && <p role="alert" className="chart-setting-error">{error}</p>}
    <div className="chart-settings-actions"><button type="button" className="text-button" onClick={() => { setDraft({ ...DEFAULT_CHART_SETTINGS }); setError(""); }}><RotateCcw size={17} />Kembalikan default</button><Button type="submit"><Check size={17} />Terapkan pengaturan</Button></div>
  </form>;
}
