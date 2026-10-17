import type { HorizonSummary, ReplayTrade } from "./types";
import type { Timeframe } from "../types";

/** Deterministic PRNG so published confidence intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** Percentile bootstrap interval for mean R. */
export function bootstrapMean(values: number[], resamples = 2000, seed = 17): [number, number] | null {
  if (values.length < 10) return null;
  const random = mulberry32(seed), means: number[] = [];
  for (let i = 0; i < resamples; i++) { let sum = 0; for (let j = 0; j < values.length; j++) sum += values[Math.floor(random() * values.length)]; means.push(sum / values.length); }
  means.sort((a, b) => a - b);
  return [quantile(means, .05), quantile(means, .95)];
}

/** 95th-percentile peak-to-trough drawdown of cumulative R across shuffled trade orders. */
export function monteCarloDrawdown(values: number[], runs = 1000, seed = 29): number | null {
  if (values.length < 10) return null;
  const random = mulberry32(seed), drawdowns: number[] = [], order = [...values];
  for (let run = 0; run < runs; run++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let equity = 0, peak = 0, worst = 0;
    for (const value of order) { equity += value; peak = Math.max(peak, equity); worst = Math.max(worst, peak - equity); }
    drawdowns.push(worst);
  }
  drawdowns.sort((a, b) => a - b);
  return quantile(drawdowns, .95);
}

export const R_BINS = [-Infinity, -1.5, -1, -.5, 0, .5, 1, 2, 3, Infinity];

/** Pool every symbol's completed trades for one horizon. "validated" needs 100 trades and a positive 90% lower bound. */
export function summarizeHorizon(timeframe: Timeframe, trades: ReplayTrade[]): HorizonSummary {
  const r = trades.map(t => t.rMultiple ?? 0);
  const wins = trades.filter(t => t.pnl > 0), gross = wins.reduce((s, t) => s + t.pnl, 0), loss = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const interval = bootstrapMean(r);
  const reasons = { stopped: 0, trail: 0, target: 0, time: 0 };
  for (const t of trades) {
    if (t.status === "TP3") reasons.target++;
    else if (t.status === "STOPPED") reasons.stopped++;
    else if (t.scaled) reasons.trail++;
    else reasons.time++;
  }
  return { timeframe, trades: trades.length, winRate: trades.length ? wins.length / trades.length * 100 : null, profitFactor: loss > 0 ? gross / loss : null,
    expectancyR: r.length ? r.reduce((s, v) => s + v, 0) / r.length : null, ciLowR: interval?.[0] ?? null, ciHighR: interval?.[1] ?? null,
    drawdownR95: monteCarloDrawdown(r), exitReasons: reasons,
    histogram: R_BINS.slice(0, -1).map((low, i) => ({ low: Number.isFinite(low) ? low : null, high: Number.isFinite(R_BINS[i + 1]) ? R_BINS[i + 1] : null, count: r.filter(v => v >= low && v < R_BINS[i + 1]).length })),
    validated: trades.length >= 100 && (interval?.[0] ?? -1) > 0 };
}
