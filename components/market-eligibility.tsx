"use client";

import type { Action, MarketSetup, Timeframe } from "@/lib/types";
export { QualificationSummary } from "./research-decision";

export function MarketEligibility({ setups, timeframe, onFilter }: { setups: MarketSetup[]; timeframe: Timeframe; onFilter: (action: Action) => void }) {
  const counts = { BUY: 0, WAIT: 0, "NO TRADE": 0 };
  for (const setup of setups) counts[setup.action]++;
  return <section className="eligibility-overview" aria-label={`${timeframe.toUpperCase()} recommendation eligibility`}>
    <div className="eligibility-heading"><strong>{timeframe.toUpperCase()} qualification</strong><span>{setups.length} analyzed markets</span></div>
    <div className="eligibility-counts">
      {(["BUY", "WAIT", "NO TRADE"] as Action[]).map(action => <button key={action} className={action === "BUY" ? "qualified" : action === "WAIT" ? "conditional" : "rejected"} onClick={() => onFilter(action)} aria-label={`Show ${counts[action]} ${action} markets`}><strong>{counts[action]}</strong><span>{action}</span><small>{action === "BUY" ? "Qualified plans" : action === "WAIT" ? "Awaiting confirmation" : "Requirements unmet"}</small></button>)}
    </div>
    <p>{counts.BUY ? "BUY plans pass the current technical, volume and risk checks. Entry still requires the published limit conditions." : counts.WAIT ? "No BUY qualified on this scan. WAIT plans are watch candidates; they cannot be entered in the simulator until a new BUY qualifies." : "No BUY or WAIT plan passed this horizon's requirements. Inspect rejected assets to see the specific blockers."}</p>
  </section>;
}
