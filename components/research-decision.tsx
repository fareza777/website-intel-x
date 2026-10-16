"use client";
import { BookOpen, CircleCheck, Clock3, Info, ShieldAlert } from "lucide-react";
import type { MarketSetup } from "@/lib/types";
import { dollars } from "@/lib/utils";
import { explainCheck, explainDecision, positionLoss, riskLesson } from "@/lib/research-explanation";

export function QualificationSummary({ setup, capital = 10_000, risk = 1, onGuide }: { setup: MarketSetup; capital?: number; risk?: number; onGuide?: () => void }) {
  const decision = explainDecision(setup), loss = positionLoss(setup);
  const lesson = loss !== null ? riskLesson(loss, capital, risk) : null;
  const required = setup.qualification?.filter(check => check.requiredFor !== "context") ?? [];
  const context = setup.qualification?.filter(check => check.requiredFor === "context") ?? [];
  return <div className="qualification-summary">
    <div className={`decision-explanation ${setup.action === "NO TRADE" ? "rejected" : setup.action === "WAIT" ? "conditional" : "qualified"}`}><strong>{decision.title}</strong><p>{decision.summary}</p></div>
    {loss !== null && <details className="risk-lesson"><summary>Understand risk <span>{loss.toFixed(2)}% position ≠ {risk}% capital</span></summary>
      <p><b>Position risk</b> is the estimated share of position funds lost if price reaches the stop, including fees and slippage. With 100 USDT in the position, planned loss is about <b>{dollars(loss)}</b>. Price gaps can increase the loss.</p>
      {setup.riskReview && !setup.plan && <div className="risk-diagnostic-levels"><span>Tested entry <b>{dollars(setup.riskReview.entry)}</b></span><span>Tested stop <b>{dollars(setup.riskReview.stopLoss)}</b></span><small>Diagnostic levels for qualification. This plan has not passed.</small></div>}
      {lesson && <p><b>Account risk</b> uses your capital: {dollars(capital)} × {risk}% = <b>{dollars(lesson.accountBudget)}</b> loss budget per trade. At this stop distance, the calculated maximum position debit is about <b>{dollars(lesson.approximateDebit)}</b>, before lot rounding and minimum-order checks.</p>}
      <p>The {setup.riskReview?.maximumLossPct ?? 8}% position-loss limit is an application strategy policy. Support and ATR determine the stop; the account risk budget determines position size. Strategy performance is evaluated separately in Strategy Lab.</p>
    </details>}
    <div className="method-evidence-note"><span>{setup.policy ? `${setup.strategyVersion} · trend-following breakout / pullback.` : "Method: trend + momentum + structure + volume."}<small>Research strategy; score is not win probability.</small></span>{onGuide && <button onClick={onGuide}><BookOpen size={17} />Method & evidence</button>}</div>
    {!!setup.qualification?.length && <details className="qualification-checklist"><summary>Required · {required.filter(check => check.passed).length}/{required.length} passed{context.length > 0 && ` · supporting ${context.filter(check => check.passed).length}/${context.length}`}</summary><div>{setup.qualification.map(check => {
      const explanation = explainCheck(check, setup);
      return <div className={`qualification-check ${check.requiredFor === "context" ? "context" : check.passed ? "passed" : check.requiredFor === "plan" ? "blocked" : "pending"}`} key={check.id}>{check.requiredFor === "context" ? <Info size={17} /> : check.passed ? <CircleCheck size={17} /> : check.requiredFor === "plan" ? <ShieldAlert size={17} /> : <Clock3 size={17} />}<div><strong>{explanation.label}<span>{check.requiredFor === "context" ? "SUPPORTING" : check.passed ? "PASSED" : check.requiredFor === "plan" ? "UNMET" : "WAITING"}</span></strong><p>{explanation.meaning}</p>{explanation.measured && <p className="check-measurement">{explanation.measured}</p>}</div></div>;
    })}</div></details>}
  </div>;
}
