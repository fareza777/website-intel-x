import type { EdgeEstimate, MarketFeatures, Timeframe } from "../types";
import { boostedProbability, type BoostedModel } from "./boosting";
import { DERIVATIVE_KEYS } from "./derivative-keys";
import type { RotationBacktest, RotationParams } from "./rotation";

/** v2 adds futures positioning features and an explicit derivative-availability flag. */
export const FEATURE_VERSION = 2;
export const FEATURE_KEYS: (keyof MarketFeatures)[] = ["score", "trendAtr", "slopeAtr", "rsi", "adx", "atrPercentile", "squeeze", "distanceHighAtr", "volumeZ", "buyPressure",
  "relativeStrength", "beta", "btcTrend", "breadth", "breakout", "reclaim", "pullback", "stopRisk", "swingStructure", "aboveVwap", ...DERIVATIVE_KEYS, "hasDerivatives"];

export interface LogisticModel { weights: number[]; bias: number; means: number[]; scales: number[] }
export interface HorizonValidation {
  /** Chronological holdout inside the training window, after a purge gap. */
  start: string; end: string; samples: number; baseWinRate: number; auc: number | null; brier: number;
  allMeanR: number; selected: number; selectedWinRate: number | null; selectedMeanR: number | null;
  calibration: { predicted: number; observed: number; count: number }[];
}
export interface HorizonModel extends LogisticModel {
  /** Which learner produced the probability; logistic means/scales also impute missing inputs. */
  learner?: "logistic" | "gbdt"; boosted?: BoostedModel;
  exitProfile: string; minimumEdgeR: number; avgWinR: number; avgLossR: number; samples: number; wins: number;
  validated: boolean; validation: HorizonValidation; reason: string;
}
/** Client-safe view of a model: everything except weights and trees. */
export type HorizonSummaryView = Omit<HorizonModel, "weights" | "bias" | "means" | "scales" | "boosted">;
export interface ModelSummary extends Omit<CalibrationModel, "horizons"> { horizons: Partial<Record<Timeframe, HorizonSummaryView>> }
export function summarizeModel(model: CalibrationModel): ModelSummary {
  return { ...model, horizons: Object.fromEntries(Object.entries(model.horizons).map(([frame, horizon]) => {
    const { weights: _w, bias: _b, means: _m, scales: _s, boosted: _t, ...rest } = horizon;
    void _w; void _b; void _m; void _s; void _t;
    return [frame, rest];
  })) };
}
export interface CalibrationModel {
  version: string; featureVersion: number; strategyVersion: string; generatedAt: string | null;
  trainedFrom: string | null; trainedThrough: string | null; universe: string[];
  horizons: Partial<Record<Timeframe, HorizonModel>>; notes: string[];
  /** Momentum Rotation parameters chosen on the same training window, with that window's backtest. */
  rotation?: { params: RotationParams; train: RotationBacktest; grid: Omit<RotationBacktest, "equity">[] };
}


export function sigmoid(value: number): number { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))); }
export function vectorize(features: MarketFeatures): (number | null)[] { return FEATURE_KEYS.map(key => features[key] ?? null); }
/** Missing inputs take the training mean, which is neutral for both learners' standardized view. */
export function impute(row: (number | null)[], means: number[]): number[] { return row.map((value, i) => value === null || !Number.isFinite(value) ? means[i] : value); }

export function predictProbability(model: LogisticModel, row: number[]): number {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * (row[i] - model.means[i]) / model.scales[i];
  return sigmoid(z);
}

/** L2-regularized logistic regression fitted by Newton/IRLS on standardized features. */
export function trainLogistic(rows: number[][], labels: number[], l2 = 2, iterations = 30): LogisticModel {
  if (!rows.length || rows.length !== labels.length) throw new Error("Training requires matching rows and labels");
  const k = rows[0].length, n = rows.length;
  const means = Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
  const scales = means.map((mean, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - mean) ** 2, 0) / n) || 1);
  const x = rows.map(r => [1, ...r.map((v, j) => (v - means[j]) / scales[j])]);
  const beta = Array(k + 1).fill(0);
  const rate = labels.reduce((s, v) => s + v, 0) / n;
  beta[0] = Math.log(Math.max(1e-3, rate) / Math.max(1e-3, 1 - rate));
  for (let iter = 0; iter < iterations; iter++) {
    const gradient = Array(k + 1).fill(0), hessian = Array.from({ length: k + 1 }, () => Array(k + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const p = sigmoid(x[i].reduce((s, v, j) => s + v * beta[j], 0)), w = Math.max(1e-6, p * (1 - p));
      for (let a = 0; a <= k; a++) {
        gradient[a] += (labels[i] - p) * x[i][a];
        for (let b = a; b <= k; b++) hessian[a][b] += w * x[i][a] * x[i][b];
      }
    }
    for (let a = 1; a <= k; a++) { gradient[a] -= l2 * beta[a]; hessian[a][a] += l2; }
    for (let a = 0; a <= k; a++) for (let b = 0; b < a; b++) hessian[a][b] = hessian[b][a];
    const step = solve(hessian, gradient);
    let change = 0;
    for (let a = 0; a <= k; a++) { beta[a] += step[a]; change = Math.max(change, Math.abs(step[a])); }
    if (change < 1e-7) break;
  }
  return { bias: beta[0], weights: beta.slice(1), means, scales };
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length, a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row, i) => Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]);
}

/** Rank AUC with tie handling. */
export function auc(scores: number[], labels: number[]): number | null {
  const positives = labels.filter(Boolean).length, negatives = labels.length - positives;
  if (!positives || !negatives) return null;
  const order = scores.map((score, i) => ({ score, label: labels[i] })).sort((a, b) => a.score - b.score);
  let rankSum = 0;
  for (let i = 0; i < order.length;) {
    let j = i; while (j < order.length && order[j].score === order[i].score) j++;
    const rank = (i + j + 1) / 2;
    for (let m = i; m < j; m++) if (order[m].label) rankSum += rank;
    i = j;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

export function expectedR(model: Pick<HorizonModel, "avgWinR" | "avgLossR">, probability: number): number {
  return probability * model.avgWinR - (1 - probability) * model.avgLossR;
}

export function estimateEdge(model: CalibrationModel | null | undefined, timeframe: Timeframe, features: MarketFeatures): EdgeEstimate | null {
  const horizon = model?.horizons[timeframe];
  if (!model || !horizon || model.featureVersion !== FEATURE_VERSION || horizon.weights.length !== FEATURE_KEYS.length) return null;
  const row = impute(vectorize(features), horizon.means);
  const probability = horizon.learner === "gbdt" && horizon.boosted ? boostedProbability(horizon.boosted, row) : predictProbability(horizon, row);
  return { modelVersion: model.version, probability, expectedR: expectedR(horizon, probability), minimumEdgeR: horizon.minimumEdgeR, validated: horizon.validated, trainedThrough: model.trainedThrough ?? "" };
}
