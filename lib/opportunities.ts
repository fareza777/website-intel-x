import type { Action, MarketSetup } from "./types";

const priority: Record<Action, number> = { BUY: 0, WAIT: 1, "NO TRADE": 2 };

/** Validated calibrated edge, when present, ranks before rule agreement. */
const edgeRank = (setup: MarketSetup) => setup.edge?.validated ? setup.edge.expectedR : -Infinity;

/** Eligibility sorts before expected edge and technical agreement; neither score nor plan is modified. */
export function compareOpportunities(a: MarketSetup, b: MarketSetup): number {
  const left = edgeRank(a), right = edgeRank(b);
  const edge = left === right ? 0 : right > left ? 1 : -1;
  return priority[a.action] - priority[b.action] || edge || b.score - a.score || b.quoteVolume24h - a.quoteVolume24h || a.symbol.localeCompare(b.symbol);
}

export function setupBlockers(setup: MarketSetup): string[] {
  const structured = setup.qualification?.filter(check => check.requiredFor === "plan" && !check.passed).map(check => check.detail);
  if (structured?.length) return structured;
  return setup.reasons.filter(reason => /^(Rejected|No valid|Rule agreement is too weak)/.test(reason));
}
