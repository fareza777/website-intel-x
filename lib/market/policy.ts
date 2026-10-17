import type { MarketSetup, Timeframe } from "../types";
export const STRATEGY_VERSION = "cx-spot-6";
/** Fixed application tolerances, frozen before replay; not optimized profit parameters. */
export const QUALIFICATION_POLICIES: Record<Timeframe, NonNullable<MarketSetup["policy"]>> = {
  "15m": { maximumAtrPct: 4, maximumStopRiskPct: 8, minimumBuyScore: 78 },
  "1h": { maximumAtrPct: 6, maximumStopRiskPct: 10, minimumBuyScore: 78 },
  "4h": { maximumAtrPct: 10, maximumStopRiskPct: 20, minimumBuyScore: 78 },
  "1d": { maximumAtrPct: 12, maximumStopRiskPct: 25, minimumBuyScore: 78 },
};

/** An exit profile: TP1 scale-out multiple, final target multiple and trailing ATR multiple. */
export interface ExitProfile { id: string; partialR: number; finalR: number; trailMultiple: number; partialFraction: number }
const profile = (partialR: number, finalR: number, trailMultiple: number): ExitProfile =>
  ({ id: `p${partialR}-f${finalR}-t${trailMultiple}`, partialR, finalR, trailMultiple, partialFraction: .5 });
/** Candidate grid evaluated by the trainer on its own training window only. */
export const EXIT_PROFILES: ExitProfile[] = [1, 1.5, 2].flatMap(partialR => [3, 5].flatMap(finalR => [2, 3].map(trail => profile(partialR, finalR, trail))));
/** Used when no trained profile exists for a horizon. */
export const DEFAULT_EXIT_PROFILE = profile(1.5, 4, 3);
export function exitProfile(id: string | undefined): ExitProfile {
  return EXIT_PROFILES.find(item => item.id === id) ?? DEFAULT_EXIT_PROFILE;
}

/** Long-only spot research pauses when the market leader and participation are both weak. */
export const REGIME = { riskOffBreadth: .3, weakBreadth: .45 } as const;
/** Position-size reductions applied to the user's chosen account-risk budget. */
export const SIZING = { highVolatilityPercentile: .8, highVolatilityMultiplier: .5, highBeta: 1.5, highBetaMultiplier: .75, experimentalMultiplier: .5, minimum: .25 } as const;
/** Portfolio heat: combined planned loss of every active simulation, as % of initial capital. */
export const MAX_PORTFOLIO_HEAT_PCT = 6;
