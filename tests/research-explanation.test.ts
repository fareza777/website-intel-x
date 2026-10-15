import { describe, expect, it } from "vitest";
import type { MarketSetup } from "../lib/types";
import { riskLesson, explainDecision } from "../lib/research-explanation";

describe("plain-language research risk", () => {
  it("separates loss on position debit from the account risk budget", () => {
    const result = riskLesson(15.14, 10_000, 1);
    expect(result?.accountBudget).toBe(100);
    expect(result?.lossOn100).toBeCloseTo(15.14);
    expect(result?.approximateDebit).toBeCloseTo(100 / .1514);
    expect(riskLesson(0, 10_000, 1)).toBeNull();
    expect(riskLesson(2, 1000, 5)?.approximateDebit).toBe(1000);
  });
  it("explains a risk rejection without calling its score a win rate", () => {
    const setup = { score: 93, action: "NO TRADE", timeframe: "15m", qualification: [
      { id: "risk", requiredFor: "plan", passed: false, detail: "Required stop risk 15.14% exceeds 8% after fees/slippage." },
    ], reasons: [] } as unknown as MarketSetup;
    const explanation = explainDecision(setup);
    expect(explanation.title).toMatch(/Stop loss terlalu jauh/);
    expect(explanation.summary).toContain("15.14%");
    expect(explanation.summary).toContain("nilai posisi");
    expect(explanation.summary).toContain("kebijakan");
    expect(explanation.summary).not.toMatch(/93%|peluang menang 93/);
  });
  it("gives the actual WAIT score floor for an otherwise safe rejected setup", () => {
    const explanation = explainDecision({ score: 41, action: "NO TRADE", reasons: [], qualification: [] } as unknown as MarketSetup);
    expect(explanation.summary).toContain("41/100");
    expect(explanation.summary).toContain("50");
  });
  it("does not invent a weak-score rejection for a legacy high-score setup", () => {
    const result = explainDecision({ score: 82, action: "NO TRADE", reasons: ["No valid structure/ATR plan."] } as unknown as MarketSetup);
    expect(result.summary).not.toContain("di bawah");
    expect(result.summary).toContain("Rekaman lama");
  });
});
