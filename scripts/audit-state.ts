import { readFile } from "node:fs/promises";
import type { MarketSetup, StoredState, Timeframe, TrackedSignal } from "../lib/types";
import { setupSchema } from "../lib/validation";
import { scannerReportSchema } from "../lib/research/validation";
import { BUNDLED_MODEL } from "../lib/market/bundled-model";
import { estimateEdge } from "../lib/market/model";
import { compareOpportunities } from "../lib/opportunities";
import { costFactors } from "../lib/market/risk";
import { exitProfile } from "../lib/market/policy";
import { INTERVAL_MS } from "../lib/market/binance";

/** Independent invariant checks over a published state file. Usage: tsx scripts/audit-state.ts data/state.json */
const FRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];
const problems: string[] = [];
let checks = 0;
const expect = (condition: boolean, message: string) => { checks++; if (!condition) problems.push(message); };
const close = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));

function auditSetup(setup: MarketSetup, generatedAt: number) {
  const id = `${setup.symbol} ${setup.timeframe}`;
  const parsed = setupSchema.safeParse(setup);
  expect(parsed.success, `${id}: schema ${parsed.success ? "" : parsed.error.issues[0]?.message}`);
  const checksList = setup.qualification ?? [];
  const planFailed = checksList.some(check => check.requiredFor === "plan" && !check.passed);
  const buyFailed = checksList.some(check => check.requiredFor !== "context" && !check.passed);
  if (setup.action === "BUY") expect(!buyFailed && !!setup.plan, `${id}: BUY with a failed required check`);
  if (setup.action === "WAIT") expect(!planFailed && !!setup.plan && buyFailed, `${id}: WAIT must have a plan, pass safety and miss a BUY requirement`);
  if (setup.action === "NO TRADE") expect(setup.plan === null, `${id}: NO TRADE must not publish a plan`);
  expect(setup.score >= 0 && setup.score <= 100, `${id}: score out of range`);
  const tf = setup.timeframe ?? "1h";
  expect(generatedAt - Date.parse(setup.asOf) <= 2 * INTERVAL_MS[tf] + 3_600_000, `${id}: decision candle older than two intervals at publication`);
  const plan = setup.plan;
  if (plan) {
    const [low, high] = plan.entryZone;
    expect(plan.stopLoss < low && low <= plan.entry && plan.entry <= high && high < plan.targets[0].price && plan.targets[0].price < plan.targets[1].price && plan.targets[1].price < plan.targets[2].price, `${id}: price levels out of order`);
    expect(plan.riskPct <= (setup.policy?.maximumStopRiskPct ?? 100) + 1e-9, `${id}: stop risk ${plan.riskPct} above policy`);
    const { debit, credit } = costFactors(plan.feeBps, plan.slippageBps);
    const unitDebit = plan.entry * debit, unitLoss = unitDebit - plan.stopLoss * credit;
    expect(close(plan.riskPct, unitLoss / unitDebit * 100, 1e-6), `${id}: risk % does not match levels and costs`);
    for (const target of plan.targets) expect(close(target.rr, (target.price * credit - unitDebit) / unitLoss, 1e-6), `${id}: target R does not match price`);
    if (plan.management) {
      const profile = exitProfile(plan.management.profile);
      expect(plan.management.breakevenStop > plan.entry && plan.management.breakevenStop < plan.targets[0].price, `${id}: breakeven outside entry..TP1`);
      expect(plan.targets[0].rr >= profile.partialR - 1e-6 && plan.targets[2].rr >= profile.finalR - 1e-6, `${id}: targets below the exit profile multiples`);
      expect(close(plan.management.breakevenStop * credit, unitDebit, 1e-3), `${id}: breakeven does not cover costs`);
    }
  }
  if (setup.features) {
    const recomputed = estimateEdge(BUNDLED_MODEL, tf, setup.features);
    if (recomputed && setup.edge) {
      expect(close(recomputed.probability, setup.edge.probability, 1e-9), `${id}: stored win probability differs from the bundled model`);
      expect(recomputed.validated === setup.edge.validated, `${id}: validation flag differs from the bundled model`);
    } else expect(!recomputed === !setup.edge, `${id}: edge presence differs from the bundled model`);
  }
  if (setup.edge?.validated && setup.action === "BUY") expect(setup.edge.expectedR >= setup.edge.minimumEdgeR, `${id}: BUY below minimum edge`);
  if (setup.sizing) expect(setup.sizing.riskMultiplier >= .25 && setup.sizing.riskMultiplier <= 1, `${id}: sizing multiplier out of range`);
  if (setup.market?.breadth != null) expect(setup.market.breadth >= 0 && setup.market.breadth <= 1, `${id}: breadth out of range`);
}

function auditSignal(signal: TrackedSignal) {
  const id = `signal ${signal.setup.id}`;
  const plan = signal.setup.plan;
  if (!plan) return expect(false, `${id}: no plan`);
  const fee = plan.feeBps / 10_000;
  if (signal.entryFill !== null && signal.exitFill !== null && signal.realizedReturnPct !== null)
    expect(close(signal.realizedReturnPct, (signal.exitFill * (1 - fee) / (signal.entryFill * (1 + fee)) - 1) * 100, 1e-6), `${id}: realized return does not match fills`);
  if (signal.enteredAt) expect(Date.parse(signal.enteredAt) >= Date.parse(signal.publishedAt), `${id}: entry before publication`);
  if (signal.exitAt && signal.enteredAt) expect(Date.parse(signal.exitAt) >= Date.parse(signal.enteredAt), `${id}: exit before entry`);
  if (signal.partial) expect(close(signal.partial.fill, plan.targets[0].price * (1 - plan.slippageBps / 10_000), 1e-9), `${id}: scale-out fill is not TP1 after slippage`);
  if (signal.setup.action === "WAIT") expect(signal.entryFill === null, `${id}: WAIT original has a simulated entry`);
}

async function main() {
  const file = process.argv[2] ?? "data/state.json";
  const state = JSON.parse(await readFile(file, "utf8")) as StoredState;
  const snapshot = state.snapshot;
  if (!snapshot) throw new Error("State has no snapshot");
  const generatedAt = Date.parse(snapshot.generatedAt);
  for (const tf of FRAMES) {
    const setups = snapshot.timeframes?.[tf] ?? [];
    for (const setup of setups) auditSetup(setup, generatedAt);
    expect(setups.every((setup, i) => i === 0 || compareOpportunities(setups[i - 1], setup) <= 0), `${tf}: setups are not in published ranking order`);
    expect(new Set(setups.map(setup => setup.symbol)).size === setups.length, `${tf}: duplicate symbols`);
  }
  expect(JSON.stringify(snapshot.setups) === JSON.stringify(snapshot.timeframes?.["1h"] ?? snapshot.setups), "snapshot.setups must equal the 1H view");
  const rotation = snapshot.rotation;
  if (rotation) {
    expect(rotation.regimeOn === (rotation.btcClose !== null && rotation.btcSma !== null && rotation.btcClose > rotation.btcSma), "rotation: regime flag disagrees with BTC versus its average");
    expect(rotation.picks.length <= rotation.params.holdings && (!rotation.regimeOn ? rotation.picks.length === 0 : true), "rotation: holdings exceed limit or regime off with picks");
    if (rotation.picks.length) expect(close(rotation.picks.reduce((s, p) => s + p.weight, 0), 1, 1e-9), "rotation: weights do not sum to 100%");
    expect(rotation.picks.every((pick, i) => pick.momentumPct > 0 && rotation.ranked[i]?.symbol === pick.symbol), "rotation: picks are not the top-ranked positive-momentum markets");
  }
  for (const signal of state.signals) auditSignal(signal);
  if (state.scannerValidation) {
    const parsed = scannerReportSchema.safeParse(state.scannerValidation);
    expect(parsed.success, `replay report schema ${parsed.success ? "" : parsed.error.issues[0]?.message}`);
    for (const summary of state.scannerValidation.summaries ?? [])
      expect(summary.trades === state.scannerValidation.rows.filter(row => row.timeframe === summary.timeframe).reduce((s, row) => s + row.completed, 0), `replay ${summary.timeframe}: pooled trade count differs from rows`);
  }
  const counts = Object.fromEntries(FRAMES.map(tf => [tf, (snapshot.timeframes?.[tf] ?? []).reduce<Record<string, number>>((c, s) => { c[s.action] = (c[s.action] ?? 0) + 1; return c; }, {})]));
  console.log(JSON.stringify({ file, generatedAt: snapshot.generatedAt, markets: snapshot.scanned, universe: snapshot.universeSize, counts, signals: state.signals.length, checks, problems: problems.length }));
  for (const problem of problems.slice(0, 50)) console.log(`PROBLEM ${problem}`);
  process.exitCode = problems.length ? 1 : 0;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
