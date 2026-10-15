import type { Candle, VolumeIntelligence } from "../types";

/** VWAP uses reported quote/base totals. Profile is approximate uniform candle-range allocation. */
export function volumeIntelligence(candles: Candle[], windowStart?: number): VolumeIntelligence {
  if (candles.length === 0) throw new Error("Volume analysis requires closed candles");
  const latest = candles[candles.length - 1];
  const sessionStart = windowStart ?? Math.floor(latest.closeTime / 86_400_000) * 86_400_000;
  const session = candles.filter((candle) => candle.time >= sessionStart);
  if (session.length === 0) throw new Error("No candles within the requested VWAP window");
  const baseVolume = session.reduce((sum, candle) => sum + candle.volume, 0);
  const quoteVolume = session.reduce((sum, candle) => sum + candle.quoteVolume, 0);
  const vwap = baseVolume > 0 ? quoteVolume / baseVolume : latest.close;
  const pressureWindow = windowStart === undefined ? candles.slice(-24) : session;
  const pressureVolume = pressureWindow.reduce((sum, candle) => sum + candle.volume, 0);
  const takerBuy = pressureWindow.reduce((sum, candle) => sum + candle.takerBuyVolume, 0);
  const prior = candles.slice(Math.max(0, candles.length - 21), -1);
  const meanVolume = prior.length ? prior.reduce((sum, candle) => sum + candle.volume, 0) / prior.length : 0;
  const profileWindow = windowStart === undefined ? candles.slice(-48) : session;
  const minimum = Math.min(...profileWindow.map((candle) => candle.low));
  const maximum = Math.max(...profileWindow.map((candle) => candle.high));
  const width = (maximum - minimum) / 24;
  const profile = width === 0 ? [{ price: minimum, volume: profileWindow.reduce((sum, candle) => sum + candle.volume, 0) }]
    : Array.from({ length: 24 }, (_, index) => ({ price: minimum + (index + 0.5) * width, volume: 0 }));
  if (width > 0) {
    for (const candle of profileWindow) {
      if (candle.high === candle.low) {
        const bucket = Math.min(23, Math.max(0, Math.floor((candle.close - minimum) / width)));
        profile[bucket].volume += candle.volume;
        continue;
      }
      for (let bucket = 0; bucket < profile.length; bucket++) {
        const overlap = Math.max(0, Math.min(candle.high, minimum + (bucket + 1) * width) - Math.max(candle.low, minimum + bucket * width));
        profile[bucket].volume += candle.volume * overlap / (candle.high - candle.low);
      }
    }
  }
  const poc = profile.reduce((best, bucket) => bucket.volume > best.volume ? bucket : best, profile[0]).price;
  return { vwap, poc, profile, relativeVolume: meanVolume > 0 ? latest.volume / meanVolume : 0, buyPressure: pressureVolume > 0 ? takerBuy / pressureVolume : 0.5 };
}
