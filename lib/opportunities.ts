import type { Action, MarketSetup } from "./types";

const priority: Record<Action, number> = { BUY: 0, WAIT: 1, "NO TRADE": 2 };

/** Eligibility sorts before technical agreement; neither score nor plan is modified. */
export function compareOpportunities(a: MarketSetup, b: MarketSetup): number {
  return priority[a.action] - priority[b.action] || b.score - a.score || b.quoteVolume24h - a.quoteVolume24h || a.symbol.localeCompare(b.symbol);
}

export function setupBlockers(setup: MarketSetup): string[] {
  const structured = setup.qualification?.filter(check => check.requiredFor === "plan" && !check.passed).map(check => check.detail);
  if (structured?.length) return structured;
  return setup.reasons.filter(reason => /^(Rejected|No valid|Rule agreement is too weak)/.test(reason));
}
