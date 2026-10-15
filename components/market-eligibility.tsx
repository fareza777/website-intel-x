"use client";
import { CircleCheck, Clock3, ShieldAlert } from "lucide-react";
import type { Action, MarketSetup, Timeframe } from "@/lib/types";
import { setupBlockers } from "@/lib/opportunities";

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

export function QualificationSummary({ setup }: { setup: MarketSetup }) {
  const blockers = setupBlockers(setup);
  const pending = setup.qualification?.filter(check => !check.passed && check.requiredFor === "buy").map(check => check.detail)
    ?? setup.confirmations.filter(text => text.startsWith("Await"));
  const message = setup.action === "NO TRADE" ? blockers[0] || "Technical agreement is insufficient for a valid plan."
    : setup.action === "WAIT" ? pending.slice(0, 2).join(" ") || "A fresh bullish confirmation and the remaining BUY conditions are required."
      : "The required safety and entry-confirmation checks passed at publication. Follow the fixed entry, stop and targets.";
  return <div className="qualification-summary">
    <div className={`decision-explanation ${setup.action === "NO TRADE" ? "rejected" : setup.action === "WAIT" ? "conditional" : "qualified"}`}><strong>{setup.action === "NO TRADE" ? "Why this asset is rejected" : setup.action === "WAIT" ? "What is still missing" : "Qualified research plan"}</strong><p>{message}</p>{blockers.length > 1 && setup.action === "NO TRADE" && <p>{blockers[1]}</p>}</div>
    {!!setup.qualification?.length && <details className="qualification-checklist"><summary>Entry eligibility · {setup.qualification.filter(check => check.passed).length}/{setup.qualification.length} checks passed</summary><div>{setup.qualification.map(check => <div className={`qualification-check ${check.passed ? "passed" : check.requiredFor === "plan" ? "blocked" : "pending"}`} key={check.id}>{check.passed ? <CircleCheck size={17} /> : check.requiredFor === "plan" ? <ShieldAlert size={17} /> : <Clock3 size={17} />}<div><strong>{check.label}<span>{check.passed ? "PASS" : check.requiredFor === "plan" ? "BLOCK" : "WAIT"}</span></strong><p>{check.detail}</p></div></div>)}</div></details>}
  </div>;
}
