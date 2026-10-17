import type { MarketSetup, TradePlan } from "../types";
import type { ExitProfile } from "./policy";

export const DEFAULT_COSTS = { feeBps: 10, slippageBps: 5 } as const;

export function roundToStep(value: number, step: number, direction: "down" | "up" = "down"): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return NaN;
  const units = direction === "down" ? Math.floor(value / step + 1e-10) : Math.ceil(value / step - 1e-10);
  // toPrecision removes binary residue while also supporting small exponential tick sizes.
  return Number((units * step).toPrecision(15));
}

export function costFactors(feeBps: number, slippageBps: number): { debit: number; credit: number } {
  const fee = feeBps / 10_000;
  const slip = slippageBps / 10_000;
  return { debit: (1 + slip) * (1 + fee), credit: (1 - slip) * (1 - fee) };
}

export function positionSize(plan: TradePlan, capital: number, riskPercent: number): { quantity: number; notional: number; riskAmount: number; maxLoss: number } {
  const valid = [capital, riskPercent, plan.entry, plan.stopLoss, plan.stepSize, plan.minNotional, plan.feeBps, plan.slippageBps].every(Number.isFinite)
    && capital > 0 && riskPercent > 0 && riskPercent <= 100 && plan.entry > plan.stopLoss && plan.stopLoss > 0
    && plan.stepSize > 0 && plan.minNotional >= 0 && plan.feeBps >= 0 && plan.slippageBps >= 0 && plan.feeBps < 10_000 && plan.slippageBps < 10_000;
  const riskAmount = valid ? capital * riskPercent / 100 : 0;
  const empty = { quantity: 0, notional: 0, riskAmount, maxLoss: 0 };
  if (!valid) return empty;
  const { debit, credit } = costFactors(plan.feeBps, plan.slippageBps);
  const unitCost = plan.entry * debit;
  const unitLoss = unitCost - plan.stopLoss * credit;
  let quantity = roundToStep(Math.min(riskAmount / unitLoss, capital / unitCost), plan.stepSize);
  if (quantity * unitCost > capital || quantity * unitLoss > riskAmount) quantity = roundToStep(quantity - plan.stepSize, plan.stepSize);
  if (quantity <= 0 || quantity * plan.entry < plan.minNotional) return empty;
  return { quantity, notional: quantity * plan.entry, riskAmount, maxLoss: quantity * unitLoss };
}

export interface TradePlanInput { price: number; atr: number; support?: number; tickSize: number; stepSize: number; minNotional: number; feeBps?: number; slippageBps?: number; maxRiskPct?: number; exit?: ExitProfile }
export interface TradePlanAssessment { plan: TradePlan | null; reason: "invalid_inputs" | "invalid_levels" | "risk_too_high" | "risk_too_low" | "invalid_targets" | null; riskPct: number | null; review?: MarketSetup["riskReview"] }
export const MIN_SETUP_RISK_PCT = .25;
export const MAX_SETUP_RISK_PCT = 8;

export function assessTradePlan(input: TradePlanInput): TradePlanAssessment {
  const { price, atr, support, tickSize, stepSize, minNotional } = input;
  if (![price, atr, tickSize, stepSize, minNotional].every(Number.isFinite) || price <= 0 || atr <= 0 || tickSize <= 0 || stepSize <= 0 || minNotional < 0) return { plan: null, reason: "invalid_inputs", riskPct: null };
  const feeBps = input.feeBps ?? DEFAULT_COSTS.feeBps;
  const slippageBps = input.slippageBps ?? DEFAULT_COSTS.slippageBps;
  const maxRiskPct = input.maxRiskPct ?? MAX_SETUP_RISK_PCT;
  if (!Number.isFinite(maxRiskPct) || maxRiskPct < MIN_SETUP_RISK_PCT || maxRiskPct > 50) return { plan: null, reason: "invalid_inputs", riskPct: null };
  if (![feeBps, slippageBps].every(Number.isFinite) || feeBps < 0 || slippageBps < 0 || feeBps >= 10_000 || slippageBps >= 10_000) return { plan: null, reason: "invalid_inputs", riskPct: null };
  const entry = roundToStep(price - atr * 0.1, tickSize);
  const structuralStop = support !== undefined && Number.isFinite(support) && support < entry ? support - atr * 0.25 : entry - atr * 1.5;
  const stopLoss = roundToStep(Math.min(entry - atr * 1.5, structuralStop), tickSize);
  const entryZone: [number, number] = [roundToStep(entry - atr * 0.2, tickSize), roundToStep(entry + atr * 0.1, tickSize, "up")];
  const { debit, credit } = costFactors(feeBps, slippageBps);
  const unitDebit = entry * debit;
  const unitLoss = unitDebit - stopLoss * credit;
  const riskPct = unitLoss / unitDebit * 100;
  if (stopLoss <= 0 || entryZone[0] <= stopLoss || entry <= 0 || !Number.isFinite(riskPct)) return { plan: null, reason: "invalid_levels", riskPct: null };
  const review = { entry, stopLoss, costedLossPct: riskPct, maximumLossPct: maxRiskPct, feeBps, slippageBps };
  if (riskPct > maxRiskPct) return { plan: null, reason: "risk_too_high", riskPct, review };
  if (riskPct < MIN_SETUP_RISK_PCT) return { plan: null, reason: "risk_too_low", riskPct, review };
  const base: TradePlan = { entry, entryZone, stopLoss, targets: [], riskPct, feeBps, slippageBps, tickSize, stepSize, minNotional };
  const plan = withExitProfile(base, input.exit, atr);
  if (!plan) return { plan: null, reason: "invalid_targets", riskPct, review };
  return { plan, reason: null, riskPct, review };
}

/** Rebuild targets and exit management for fixed entry/stop levels; legacy plans use 2R/3R/4R without management. */
export function withExitProfile(plan: TradePlan, exit: ExitProfile | undefined, atr: number): TradePlan | null {
  const { entry, stopLoss, tickSize, feeBps, slippageBps } = plan;
  const { debit, credit } = costFactors(feeBps, slippageBps);
  const unitDebit = entry * debit, unitLoss = unitDebit - stopLoss * credit;
  const multiples = exit ? [exit.partialR, (exit.partialR + exit.finalR) / 2, exit.finalR] : [2, 3, 4];
  const targets = multiples.map((multiple) => {
    const target = roundToStep((unitDebit + multiple * unitLoss) / credit, tickSize, "up");
    return { price: target, rr: (target * credit - unitDebit) / unitLoss, gainPct: (target * credit - unitDebit) / unitDebit * 100 };
  });
  if (targets[0].price <= entry || targets.some((target, index) => index > 0 && target.price <= targets[index - 1].price)) return null;
  // Breakeven covers both-side fees and slippage on the remaining quantity.
  const management = exit ? { kind: "scale-trail" as const, partialFraction: exit.partialFraction, breakevenStop: roundToStep(unitDebit / credit, tickSize, "up"), atr, trailMultiple: exit.trailMultiple, profile: exit.id } : undefined;
  if (management && management.breakevenStop >= targets[0].price) return null;
  const { management: _previous, ...rest } = plan;
  void _previous;
  return { ...rest, targets, ...(management ? { management } : {}) };
}

export function makeTradePlan(input: TradePlanInput): TradePlan | null { return assessTradePlan(input).plan; }
