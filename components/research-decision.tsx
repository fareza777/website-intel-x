"use client";
import { BookOpen, CircleCheck, Clock3, ShieldAlert } from "lucide-react";
import type { MarketSetup } from "@/lib/types";
import { dollars } from "@/lib/utils";
import { explainCheck, explainDecision, positionLoss, riskLesson } from "@/lib/research-explanation";

export function QualificationSummary({ setup, capital = 10_000, risk = 1, onGuide }: { setup: MarketSetup; capital?: number; risk?: number; onGuide?: () => void }) {
  const decision = explainDecision(setup), loss = positionLoss(setup);
  const lesson = loss !== null ? riskLesson(loss, capital, risk) : null;
  return <div className="qualification-summary">
    <div className={`decision-explanation ${setup.action === "NO TRADE" ? "rejected" : setup.action === "WAIT" ? "conditional" : "qualified"}`}><strong>{decision.title}</strong><p>{decision.summary}</p></div>
    {loss !== null && <details className="risk-lesson"><summary>Pahami angka risiko <span>{loss.toFixed(2)}% posisi ≠ {risk}% modal</span></summary>
      <p><b>Risiko posisi</b> adalah perkiraan bagian dana posisi yang hilang bila harga mencapai stop, termasuk fee dan slippage. Dengan dana posisi 100 USDT, kerugian terencana sekitar <b>{dollars(loss)}</b>. Gap harga dapat membuat kerugian lebih besar.</p>
      {setup.riskReview && !setup.plan && <div className="risk-diagnostic-levels"><span>Entry yang diuji <b>{dollars(setup.riskReview.entry)}</b></span><span>Stop yang diuji <b>{dollars(setup.riskReview.stopLoss)}</b></span><small>Level diagnostik untuk menilai kelayakan. Rencana ini belum lolos.</small></div>}
      {lesson && <p><b>Risiko akun</b> memakai modal Anda: {dollars(capital)} × {risk}% = <b>{dollars(lesson.accountBudget)}</b> anggaran rugi per trade. Pada jarak stop ini, dana posisi matematis maksimal sekitar <b>{dollars(lesson.approximateDebit)}</b>, sebelum pembulatan lot dan minimum order.</p>}
      <p>Batas rugi posisi {setup.riskReview?.maximumLossPct ?? 8}% adalah kebijakan strategi aplikasi. Penentuan stop memakai support dan ATR; penentuan ukuran posisi memakai anggaran risiko akun. Kelayakan hasil strateginya diperiksa terpisah di Strategy Lab.</p>
    </details>}
    <div className="method-evidence-note"><span>Metode: tren + momentum + struktur + volume.<small>Status: strategi riset; skor bukan probabilitas menang.</small></span>{onGuide && <button onClick={onGuide}><BookOpen size={17} />Metode & bukti</button>}</div>
    {!!setup.qualification?.length && <details className="qualification-checklist"><summary>Syarat entry · {setup.qualification.filter(check => check.passed).length}/{setup.qualification.length} terpenuhi</summary><div>{setup.qualification.map(check => {
      const explanation = explainCheck(check, setup);
      return <div className={`qualification-check ${check.passed ? "passed" : check.requiredFor === "plan" ? "blocked" : "pending"}`} key={check.id}>{check.passed ? <CircleCheck size={17} /> : check.requiredFor === "plan" ? <ShieldAlert size={17} /> : <Clock3 size={17} />}<div><strong>{explanation.label}<span>{check.passed ? "LOLOS" : check.requiredFor === "plan" ? "BELUM" : "TUNGGU"}</span></strong><p>{explanation.meaning}</p>{explanation.measured && <p className="check-measurement">{explanation.measured}</p>}</div></div>;
    })}</div></details>}
  </div>;
}
