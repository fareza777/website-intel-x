import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { MarketSnapshot, StoredState } from "../lib/types";
import { INTERVAL_MS } from "../lib/market/binance";
import { writeAtomicJson } from "./scan";

const numericClaim = /[\p{N}%$€£¥]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|double(?:d|s)?|triple(?:d|s)?|doubling|tripling|(?:two|three|four|five|six|seven|eight|nine|ten)fold|twice|half|quarter|percent|percentage|bps|basis\s+points?|probability|odds|guarantee(?:d|s)?)\b/iu;
const prose = z.string().trim().min(1).max(2_000).refine((value) => !numericClaim.test(value), "Model prose must be qualitative, without numeric or guaranteed claims");
const narrativeSchema = z.object({ summary: prose, plans: z.array(z.object({ id: z.string(), thesis: prose, risks: z.array(prose).min(1).max(4), discipline: prose }).strict()).min(1).max(3) }).strict();

export function validateNarrative(value: unknown, ids: string[]): z.infer<typeof narrativeSchema> {
  const narrative = narrativeSchema.parse(value);
  if (narrative.plans.length !== ids.length || new Set(narrative.plans.map((plan) => plan.id)).size !== ids.length || narrative.plans.some((plan) => !ids.includes(plan.id))) throw new Error("Narrative must reference exactly the frozen plan ids");
  return narrative;
}

/** This manual-only paid request returns prose beside immutable source numbers, never new trade data. */
export async function generateBrief(snapshot: MarketSnapshot, options: { key: string; model: string; now?: number; fetcher?: typeof fetch }) {
  const now = options.now ?? Date.now();
  const scanAge = now - Date.parse(snapshot.generatedAt);
  if (snapshot.status === "unavailable" || !Number.isFinite(scanAge) || scanAge < 0 || scanAge > 2 * 3_600_000) throw new Error("A fresh available scan is required");
  const horizons = snapshot.timeframes ? Object.values(snapshot.timeframes).flat() : [];
  const selected = (horizons.length ? horizons : snapshot.setups).filter((setup) => {
    const age = now - Date.parse(setup.asOf);
    return setup.action === "BUY" && Number.isFinite(setup.score) && setup.score >= 80 && setup.score <= 100 && setup.plan && Date.parse(setup.expiresAt) > now
      && Number.isFinite(age) && age >= 0 && age <= 2 * INTERVAL_MS[setup.timeframe ?? "1h"];
  })
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, 3);
  const frozen = structuredClone(selected.map((setup) => ({ id: setup.id, symbol: setup.symbol, timeframe: setup.timeframe ?? "1h", holdingPeriodHours: setup.holdingPeriodHours ?? 72, score: setup.score, asOf: setup.asOf, plan: setup.plan, indicators: setup.indicators, reasons: setup.reasons })));
  const digest = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
  if (!frozen.length) return { generatedAt: new Date(now).toISOString(), model: null, frozenDigest: digest, plans: [], narrative: null, note: "No qualified BUY plans at score eighty or higher; no paid request was made." };
  if (options.key.length < 8 || options.key.length > 500 || /[\r\n]/.test(options.key) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(options.model)) throw new Error("Set XAI_API_KEY and an explicit XAI_MODEL for the manual brief");
  const response = await (options.fetcher ?? fetch)("https://api.x.ai/v1/chat/completions", {
    method: "POST", redirect: "error", headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: options.model, temperature: 0, max_tokens: 1_000, response_format: { type: "json_object" }, messages: [
      { role: "system", content: "Describe only the frozen research evidence. Never propose, repeat, spell out, infer or alter any price, score, percentage, quantity, ratio, numeric probability or guaranteed outcome. All prose must be qualitative English without digits, number words, currency symbols or percent signs. Do not repeat tickers in prose. The only exception is the exact supplied id in each id field. Return strict JSON with summary and plans. Each plans item has exactly id, thesis, risks (array of qualitative strings), discipline. Include exactly the supplied ids. Do not add fields or markdown. Plans are spot research, not executions." },
      { role: "user", content: JSON.stringify({ frozenDigest: digest, plans: frozen }) },
    ] }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Optional narrative provider rejected the request (HTTP ${response.status}); existing files were preserved`); }
  const body = await response.json() as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 20_000) throw new Error("Invalid or oversized provider narrative");
  const narrative = validateNarrative(JSON.parse(content), frozen.map((plan) => plan.id));
  return { generatedAt: new Date(now).toISOString(), model: options.model, sourceGeneratedAt: snapshot.generatedAt, frozenDigest: digest, plans: frozen, narrative, note: "Optional qualitative model commentary. All trade numbers are frozen deterministic source data." };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: "string", default: "data/state.json" }, output: { type: "string", default: "data/brief.json" } } });
  const state = JSON.parse(await readFile(path.resolve(values.input), "utf8")) as StoredState;
  if (!state.snapshot) throw new Error("Publish a real snapshot before requesting an optional brief");
  const brief = await generateBrief(state.snapshot, { key: process.env.XAI_API_KEY ?? "", model: process.env.XAI_MODEL ?? "" });
  await writeAtomicJson(path.resolve(values.output), brief);
  console.log(JSON.stringify({ output: path.resolve(values.output), plans: brief.plans.length, model: brief.model }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error("Optional brief failed validation or provider access. Existing output and numeric trade data were preserved; no automatic retry was made."); process.exitCode = 1; });
}
