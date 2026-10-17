import type { MarketSetup, Timeframe, TrackedSignal } from "../types";
import { analyzeSymbol } from "../market/setup";
import { INTERVAL_MS } from "../market/binance";
import { withExitProfile } from "../market/risk";
import { EXIT_PROFILES, DEFAULT_EXIT_PROFILE, type ExitProfile } from "../market/policy";
import { auc, expectedR, FEATURE_KEYS, FEATURE_VERSION, impute, predictProbability, trainLogistic, vectorize, type CalibrationModel, type HorizonModel, type HorizonValidation, type LogisticModel } from "../market/model";
import { boostedProbability, trainBoosted, type BoostedModel } from "../market/boosting";
import { bootstrapMean } from "./stats";
import { advanceSignal, executionInterval, executionIntervalMs } from "../tracking";
import { derivativeMap, historicalInput, replayContext, type ReplaySource } from "./replay";

const HOUR = 3_600_000;
export const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];
export const EDGE_THRESHOLDS = [0, .1, .2, .3];
const LEGACY = "legacy";

export interface Candidate {
  symbol: string; timeframe: Timeframe; publishedAt: number; setup: MarketSetup; features: (number | null)[];
  /** Would the rule-based fallback (score floor) have published BUY? */
  ruleBuy: boolean;
  /** Realized R per exit profile, null when the limit entry never filled. */
  outcomes: Record<string, number | null>;
}

/** Long-entry candidates: every mandatory check except the score floor, calibration and edge. */
export function isCandidate(setup: MarketSetup): boolean {
  if (!setup.plan || !setup.entryModel || !setup.qualification) return false;
  return setup.qualification.every(check => check.requiredFor === "context" || check.passed || ["score", "calibration", "edge"].includes(check.id));
}
export function isRuleBuy(setup: MarketSetup): boolean {
  return isCandidate(setup) && setup.qualification!.every(check => check.requiredFor === "context" || check.passed || check.id === "calibration" || check.id === "edge")
    && setup.score >= (setup.policy?.minimumBuyScore ?? 78);
}

/** Simulate one candidate with the production lifecycle engine. Returns realized R or null without a fill. */
export function simulateOutcome(setup: MarketSetup, publishedAt: number, source: ReplaySource, exit: ExitProfile | null, dataEnd: number): number | null | undefined {
  const timeframe = setup.timeframe ?? "1h";
  const plan = withExitProfile(setup.plan!, exit ?? undefined, setup.indicators[timeframe]!.atr);
  if (!plan) return null;
  const signal: TrackedSignal = { setup: { ...setup, action: "BUY", plan }, publishedAt: new Date(publishedAt).toISOString(), status: "PENDING", enteredAt: null, entryFill: null,
    exitAt: null, exitFill: null, lastEvaluatedTime: 0, highestTarget: 0, realizedReturnPct: null, events: [] };
  const duration = executionIntervalMs(signal);
  const windowEnd = Date.parse(setup.expiresAt) + (setup.holdingPeriodHours ?? 72) * HOUR + 2 * duration;
  // Labels must never read data from the later evaluation window.
  if (windowEnd > dataEnd) return undefined;
  const all = source.candles[executionInterval(signal)];
  const first = Math.ceil(publishedAt / duration) * duration;
  let lo = 0, hi = all.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (all[mid].time < first) lo = mid + 1; else hi = mid; }
  const slice = [];
  for (let i = lo; i < all.length && all[i].closeTime < windowEnd; i++) slice.push(all[i]);
  const result = advanceSignal(signal, slice, windowEnd);
  if (result.entryFill === null || result.realizedReturnPct === null) return null;
  return result.realizedReturnPct / plan.riskPct;
}

/** Hourly :17 scans across the universe, each decision bar labelled once at its first publication. */
export function collectCandidates(sources: ReplaySource[], start: number, end: number, dataEnd: number, onProgress?: (done: number, total: number) => void): Candidate[] {
  const seen = new Set<string>(), candidates: Candidate[] = [];
  const profiles = [...EXIT_PROFILES, null];
  const total = Math.floor((end - start) / HOUR) + 1;
  const derivatives = derivativeMap(sources);
  for (let now = start, step = 0; now <= end; now += HOUR, step++) {
    if (onProgress && step % 500 === 0) onProgress(step, total);
    const inputs = sources.map(source => historicalInput(source, now));
    const context = replayContext(inputs, null, derivatives);
    for (const [index, input] of inputs.entries()) {
      for (const timeframe of TIMEFRAMES) {
        // Higher frames only change when a new decision bar closes; skip identical repeats.
        const lastClose = input.candles[timeframe]?.at(-1)?.closeTime;
        if (lastClose === undefined || seen.has(`${input.symbol}:${timeframe}:${lastClose}`)) continue;
        seen.add(`${input.symbol}:${timeframe}:${lastClose}`);
        let setup: MarketSetup;
        try { setup = analyzeSymbol(input, timeframe, context); } catch { continue; }
        if (!isCandidate(setup) || !setup.features) continue;
        const outcomes: Record<string, number | null> = {};
        let complete = true;
        for (const profile of profiles) {
          const value = simulateOutcome(setup, now, sources[index], profile, dataEnd);
          if (value === undefined) { complete = false; break; }
          outcomes[profile?.id ?? LEGACY] = value;
        }
        if (complete) candidates.push({ symbol: input.symbol, timeframe, publishedAt: now, setup, features: vectorize(setup.features), ruleBuy: isRuleBuy(setup), outcomes });
      }
    }
  }
  return candidates;
}

export type Learner = "logistic" | "gbdt";
export interface ProfileReport { profile: string; learner: Learner; fitSamples: number; validationSamples: number; auc: number | null; threshold: number; selected: number; selectedMeanR: number | null; selectedWinRate: number | null; selectedSumR: number; selectedLowR: number | null; allMeanR: number; ruleSelected: number; ruleMeanR: number | null }
export const LEARNERS: Learner[] = ["logistic", "gbdt"];

const mean = (values: number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

/** Column means over observed values; they impute missing inputs for both learners. */
export function columnMeans(rows: (number | null)[][]): number[] {
  const k = rows[0]?.length ?? 0;
  return Array.from({ length: k }, (_, j) => mean(rows.map(row => row[j]).filter((v): v is number => v !== null && Number.isFinite(v))) ?? 0);
}

interface Fitted { logistic: LogisticModel; boosted?: BoostedModel; means: number[]; predict: (row: (number | null)[]) => number }
function fitLearner(rows: (number | null)[][], labels: number[], learner: Learner): Fitted {
  const means = columnMeans(rows), filled = rows.map(row => impute(row, means));
  const logistic = trainLogistic(filled, labels);
  if (learner === "logistic") return { logistic, means, predict: row => predictProbability(logistic, impute(row, means)) };
  const boosted = trainBoosted(filled, labels);
  return { logistic, boosted, means, predict: row => boostedProbability(boosted, impute(row, means)) };
}

function evaluate(fit: Candidate[], validation: Candidate[], profile: string, learner: Learner) {
  const fitRows = fit.filter(c => c.outcomes[profile] != null), validRows = validation.filter(c => c.outcomes[profile] != null);
  const report: ProfileReport = { profile, learner, fitSamples: fitRows.length, validationSamples: validRows.length, auc: null, threshold: 0, selected: 0, selectedMeanR: null, selectedWinRate: null, selectedSumR: 0, selectedLowR: null,
    allMeanR: mean(validRows.map(c => c.outcomes[profile]!)) ?? 0, ruleSelected: 0, ruleMeanR: null };
  const rules = validRows.filter(c => c.ruleBuy).map(c => c.outcomes[profile]!);
  report.ruleSelected = rules.length; report.ruleMeanR = mean(rules);
  const empty = { report, fitted: null as Fitted | null, payoff: null as { avgWinR: number; avgLossR: number } | null, probabilities: [] as number[], validRows };
  if (fitRows.length < 40 || validRows.length < 20) return empty;
  const labels = fitRows.map(c => c.outcomes[profile]! > 0 ? 1 : 0);
  if (labels.every(v => v === labels[0])) return empty;
  const fitted = fitLearner(fitRows.map(c => c.features), labels, learner);
  const wins = fitRows.map(c => c.outcomes[profile]!).filter(r => r > 0), losses = fitRows.map(c => c.outcomes[profile]!).filter(r => r <= 0);
  const payoff = { avgWinR: mean(wins) ?? 0, avgLossR: -(mean(losses) ?? 0) };
  const probabilities = validRows.map(c => fitted.predict(c.features));
  report.auc = auc(probabilities, validRows.map(c => c.outcomes[profile]! > 0 ? 1 : 0));
  let best = { threshold: 0, selected: [] as number[], sum: -Infinity };
  for (const threshold of EDGE_THRESHOLDS) {
    const selected = validRows.filter((_, i) => expectedR(payoff, probabilities[i]) >= threshold).map(c => c.outcomes[profile]!);
    const sum = selected.reduce((s, v) => s + v, 0);
    if (selected.length >= 15 && sum > best.sum) best = { threshold, selected, sum };
  }
  if (best.sum > -Infinity) Object.assign(report, { threshold: best.threshold, selected: best.selected.length, selectedMeanR: mean(best.selected),
    selectedWinRate: mean(best.selected.map(r => r > 0 ? 1 : 0)), selectedSumR: best.sum, selectedLowR: bootstrapMean(best.selected)?.[0] ?? null });
  return { report, fitted, payoff, probabilities, validRows };
}

/** Choose exit profile, learner and edge threshold on a purged chronological holdout, then refit on all training rows. */
export function fitHorizon(candidates: Candidate[], timeframe: Timeframe, learners: Learner[] = LEARNERS): { model: HorizonModel | null; profiles: ProfileReport[] } {
  const rows = candidates.filter(c => c.timeframe === timeframe).sort((a, b) => a.publishedAt - b.publishedAt);
  if (rows.length < 80) return { model: null, profiles: [] };
  const cut = rows[Math.floor(rows.length * .7)].publishedAt;
  const sample = rows[0].setup;
  // Purge: a fit label may not overlap the holdout's first decision.
  const purge = (Date.parse(sample.expiresAt) - Date.parse(sample.asOf)) + (sample.holdingPeriodHours ?? 72) * HOUR + INTERVAL_MS[timeframe];
  const fit = rows.filter(c => c.publishedAt + purge <= cut), validation = rows.filter(c => c.publishedAt >= cut);
  const evaluated = [...EXIT_PROFILES.map(p => p.id), LEGACY].flatMap(profile => learners.map(learner => ({ profile, learner, ...evaluate(fit, validation, profile, learner) })));
  const managed = evaluated.filter(item => item.profile !== LEGACY && item.fitted && item.report.selected >= 15);
  const chosen = managed.sort((a, b) => b.report.selectedSumR - a.report.selectedSumR)[0];
  // The chosen selection's 90% bootstrap lower bound must be positive: a guard against a lucky pick from the search grid.
  const validated = !!chosen && (chosen.report.auc ?? 0) >= .55 && (chosen.report.selectedLowR ?? -Infinity) > 0 && (chosen.report.selectedMeanR ?? 0) > chosen.report.allMeanR;
  // Without a validated model, keep the exit profile that best served the rule-based candidates on training rows.
  const fallback = [...EXIT_PROFILES].map(p => ({ id: p.id, sum: rows.filter(c => c.ruleBuy && c.outcomes[p.id] != null).reduce((s, c) => s + c.outcomes[p.id]!, 0), n: rows.filter(c => c.ruleBuy && c.outcomes[p.id] != null).length }))
    .filter(item => item.n >= 10).sort((a, b) => b.sum - a.sum)[0];
  const profile = validated ? chosen.profile : fallback?.id ?? DEFAULT_EXIT_PROFILE.id;
  const learner: Learner = validated ? chosen.learner : "logistic";
  const all = rows.filter(c => c.outcomes[profile] != null);
  const labels = all.map(c => c.outcomes[profile]! > 0 ? 1 : 0);
  const profiles = evaluated.map(item => item.report);
  if (all.length < 40 || labels.every(v => v === labels[0])) return { model: null, profiles };
  const final = fitLearner(all.map(c => c.features), labels, learner);
  const wins = all.map(c => c.outcomes[profile]!).filter(r => r > 0), losses = all.map(c => c.outcomes[profile]!).filter(r => r <= 0);
  const source = evaluated.find(item => item.profile === profile && item.learner === learner)!;
  const validRows = source.validRows, probabilities = source.probabilities;
  const order = probabilities.map((p, i) => ({ p, y: validRows[i].outcomes[profile]! > 0 ? 1 : 0 })).sort((a, b) => a.p - b.p);
  const calibration = order.length >= 25 ? Array.from({ length: 5 }, (_, bin) => {
    const part = order.slice(Math.floor(bin * order.length / 5), Math.floor((bin + 1) * order.length / 5));
    return { predicted: mean(part.map(x => x.p))!, observed: mean(part.map(x => x.y))!, count: part.length };
  }) : [];
  const validation_: HorizonValidation = { start: new Date(cut).toISOString(), end: new Date(rows.at(-1)!.publishedAt).toISOString(), samples: validRows.length,
    baseWinRate: mean(validRows.map(c => c.outcomes[profile]! > 0 ? 1 : 0)) ?? 0, auc: source.report.auc,
    brier: order.length ? order.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / order.length : 1, allMeanR: source.report.allMeanR, selected: source.report.selected,
    selectedWinRate: source.report.selectedWinRate, selectedMeanR: source.report.selectedMeanR, calibration };
  const reason = validated ? `${learner === "gbdt" ? "Gradient boosting" : "Logistic"} model · holdout AUC ${source.report.auc?.toFixed(3)}; ${source.report.selected} selected trades averaged ${source.report.selectedMeanR?.toFixed(3)}R (90% lower bound ${source.report.selectedLowR?.toFixed(3)}R) versus ${source.report.allMeanR.toFixed(3)}R for every candidate.`
    : `Holdout checks not met (AUC ≥0.55, ≥15 selected trades, positive 90% bootstrap lower bound on selected mean R, and better than the candidate average). This horizon stays research-only: no BUY plans.`;
  return { profiles, model: { ...final.logistic, means: final.means, learner, ...(final.boosted ? { boosted: final.boosted } : {}), exitProfile: profile, minimumEdgeR: validated ? source.report.threshold : 0,
    avgWinR: mean(wins) ?? 0, avgLossR: -(mean(losses) ?? 0), samples: all.length, wins: wins.length, validated, validation: validation_, reason } };
}

export function buildModel(candidates: Candidate[], meta: { strategyVersion: string; generatedAt: string; trainedFrom: string; trainedThrough: string; universe: string[] }): { model: CalibrationModel; profiles: Record<string, ProfileReport[]> } {
  const horizons: CalibrationModel["horizons"] = {}, profiles: Record<string, ProfileReport[]> = {};
  for (const timeframe of TIMEFRAMES) {
    const result = fitHorizon(candidates, timeframe);
    profiles[timeframe] = result.profiles;
    if (result.model) horizons[timeframe] = result.model;
  }
  return { profiles, model: { version: `cx-model-${meta.trainedThrough.slice(0, 10)}`, featureVersion: FEATURE_VERSION, ...meta, horizons, notes: [
    `Logistic regression and gradient-boosted trees over ${FEATURE_KEYS.length} causal features (price, BTC context and lagged futures positioning), trained on long-entry candidates that pass every mandatory safety, trend, trigger and regime check.`,
    "Labels replay the production limit-entry, stop-first, scale-out, trailing-stop and time-exit engine with fees and slippage. Unfilled entries are excluded.",
    "Exit profile, learner and minimum edge are chosen on a purged chronological holdout (last 30% of training decisions); the deployed model is refitted on all training rows.",
    "Training ends before the scanner replay window, so the published replay is out-of-sample for this model. Probability is an estimate, not a guarantee.",
  ] } };
}
