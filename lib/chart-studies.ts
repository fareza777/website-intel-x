import { z } from "zod";
import type { Candle } from "./types";
import { atr, ema, macd, rsi } from "./market/indicators";

const period = z.number().int().min(2).max(200);
export const chartSettingsSchema = z.object({
  version: z.literal(1), style: z.enum(["candles", "line", "area"]), scale: z.enum(["price", "log", "percent"]),
  grid: z.boolean(), magnet: z.boolean(), volume: z.boolean(), levels: z.boolean(), structure: z.boolean(),
  ema: z.boolean(), emaFast: period, emaSlow: period, emaLong: period,
  sma: z.boolean(), smaPeriod: period, bollinger: z.boolean(), bbPeriod: period, bbMultiplier: z.number().min(.5).max(4),
  vwap: z.boolean(), donchian: z.boolean(), donchianPeriod: period,
  rsi: z.boolean(), rsiPeriod: period, macd: z.boolean(), macdFast: period, macdSlow: period, macdSignal: period,
  atr: z.boolean(), atrPeriod: period,
}).refine(c => c.macdFast < c.macdSlow, { path: ["macdFast"], message: "MACD fast period must be less than slow period." });
export type ChartSettings = z.infer<typeof chartSettingsSchema>;
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  version: 1, style: "candles", scale: "price", grid: true, magnet: true, volume: true, levels: true, structure: false,
  ema: true, emaFast: 21, emaSlow: 50, emaLong: 200, sma: false, smaPeriod: 20,
  bollinger: false, bbPeriod: 20, bbMultiplier: 2, vwap: false, donchian: false, donchianPeriod: 20,
  rsi: true, rsiPeriod: 14, macd: false, macdFast: 12, macdSlow: 26, macdSignal: 9, atr: false, atrPeriod: 14,
};
export function readChartSettings(raw: string | null): ChartSettings {
  try { if (!raw || raw.length > 10_000) return { ...DEFAULT_CHART_SETTINGS }; return chartSettingsSchema.parse(JSON.parse(raw)); }
  catch { return { ...DEFAULT_CHART_SETTINGS }; }
}
export type StudyToggle = "ema" | "sma" | "bollinger" | "vwap" | "donchian" | "volume" | "rsi" | "macd" | "atr";
export const STUDY_LABELS: { key: StudyToggle; label: string }[] = [
  { key: "ema", label: "EMA" }, { key: "sma", label: "SMA" }, { key: "bollinger", label: "Bollinger" },
  { key: "vwap", label: "VWAP" }, { key: "donchian", label: "Donchian" }, { key: "volume", label: "Volume" },
  { key: "rsi", label: "RSI" }, { key: "macd", label: "MACD" }, { key: "atr", label: "ATR" },
];
export function chartPreset(name: "trend" | "momentum" | "volatility" | "clean", current: ChartSettings): ChartSettings {
  const next = { ...current, ...Object.fromEntries(STUDY_LABELS.map(s => [s.key, false])) };
  if (name === "trend") Object.assign(next, { ema: true, vwap: true, donchian: true, volume: true });
  if (name === "momentum") Object.assign(next, { ema: true, rsi: true, macd: true, volume: true });
  if (name === "volatility") Object.assign(next, { bollinger: true, rsi: true, atr: true, volume: true });
  return chartSettingsSchema.parse(next);
}

export function candleMetrics(candle: Candle, previous?: Candle) {
  if (![candle.open, candle.high, candle.low, candle.close, candle.volume, candle.takerBuyVolume].every(Number.isFinite)
    || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close)
    || candle.low > Math.min(candle.open, candle.close) || candle.volume < 0) return null;
  return { bodyPct: (candle.close / candle.open - 1) * 100, rangePct: (candle.high - candle.low) / candle.open * 100,
    previousClosePct: previous && previous.close > 0 ? (candle.close / previous.close - 1) * 100 : null,
    buyPressurePct: candle.volume > 0 ? candle.takerBuyVolume / candle.volume * 100 : null };
}
type Values = (number | null)[];
function rolling(values: number[], length: number): Values {
  return values.map((_, i) => i + 1 < length ? null : values.slice(i + 1 - length, i + 1).reduce((sum, v) => sum + v, 0) / length);
}
export function buildChartStudies(candles: Candle[], config: ChartSettings) {
  const closes = candles.map(c => c.close);
  const blank = (): Values => Array(candles.length).fill(null);
  const bbMiddle = config.bollinger ? rolling(closes, config.bbPeriod) : blank();
  const deviation = bbMiddle.map((average, i) => average === null ? null : Math.sqrt(closes.slice(i + 1 - config.bbPeriod, i + 1)
    .reduce((sum, v) => sum + (v - average) ** 2, 0) / config.bbPeriod) * config.bbMultiplier);
  let day = -1, quote = 0, base = 0;
  const vwap = candles.map(c => {
    if (!config.vwap) return null;
    const nextDay = Math.floor(c.time / 86_400_000);
    if (nextDay !== day) { day = nextDay; quote = 0; base = 0; }
    quote += c.quoteVolume; base += c.volume;
    return base > 0 ? quote / base : null;
  });
  const channel = (side: "high" | "low") => candles.map((_, i) => !config.donchian || i < config.donchianPeriod ? null
    : (side === "high" ? Math.max : Math.min)(...candles.slice(i - config.donchianPeriod, i).map(c => c[side])));
  const momentum = config.macd ? macd(closes, config.macdFast, config.macdSlow, config.macdSignal) : { line: blank(), signal: blank(), histogram: blank() };
  return {
    emaFast: config.ema ? ema(closes, config.emaFast) : blank(), emaSlow: config.ema ? ema(closes, config.emaSlow) : blank(),
    emaLong: config.ema ? ema(closes, config.emaLong) : blank(), sma: config.sma ? rolling(closes, config.smaPeriod) : blank(),
    bbMiddle, bbUpper: bbMiddle.map((v, i) => v === null ? null : v + deviation[i]!), bbLower: bbMiddle.map((v, i) => v === null ? null : v - deviation[i]!),
    vwap, donchianUpper: channel("high"), donchianLower: channel("low"),
    rsi: config.rsi ? rsi(closes, config.rsiPeriod) : blank(), macdLine: momentum.line, macdSignal: momentum.signal,
    macdHistogram: momentum.histogram, atr: config.atr ? atr(candles, config.atrPeriod) : blank(),
  };
}
