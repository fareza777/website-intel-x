import type { MarketSetup, Timeframe } from "../types";
export const STRATEGY_VERSION = "cx-spot-4";
/** Fixed application tolerances, frozen before replay; not optimized profit parameters. */
export const QUALIFICATION_POLICIES: Record<Timeframe, NonNullable<MarketSetup["policy"]>> = {
  "15m": { maximumAtrPct: 4, maximumStopRiskPct: 8, minimumBuyScore: 78 },
  "1h": { maximumAtrPct: 6, maximumStopRiskPct: 10, minimumBuyScore: 78 },
  "4h": { maximumAtrPct: 10, maximumStopRiskPct: 20, minimumBuyScore: 78 },
  "1d": { maximumAtrPct: 12, maximumStopRiskPct: 25, minimumBuyScore: 78 },
};
