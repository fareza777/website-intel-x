import { z } from "zod";
import { activeStatuses } from "./tracking";
import { eventSchema, setupSchema } from "./validation";
import { roundToStep } from "./market/risk";
import type { MarketSetup, TrackedSignal } from "./types";
export interface PaperPosition { signal: TrackedSignal; quantity: number; reserved: number; entryCost: number | null; settled: boolean; journal: string }
export interface PaperAccount { version: 1; initialCapital: number; cash: number; positions: PaperPosition[] }
export function createPaperAccount(capital = 10_000): PaperAccount {
  if (!Number.isFinite(capital) || capital < 100 || capital > 1e9) throw new Error("Virtual capital must be between $100 and $1 billion.");
  return { version: 1, initialCapital: capital, cash: capital, positions: [] };
}
const finiteMoney = z.number().finite().min(0).max(1e12);
const signalSchema = z.object({ setup: setupSchema.refine(s => s.plan !== null), status: z.enum(["PENDING", "OPEN", "TP1", "TP2", "TP3", "STOPPED", "EXPIRED", "INVALIDATED", "CLOSED"]), events: z.array(eventSchema).max(100), publishedAt: z.iso.datetime(), enteredAt: z.iso.datetime().nullable(), entryFill: finiteMoney.positive().nullable(), exitAt: z.iso.datetime().nullable(), exitFill: finiteMoney.positive().nullable(), lastEvaluatedTime: z.number().finite().nonnegative(), highestTarget: z.number().int().min(0).max(3), realizedReturnPct: z.number().finite().nullable() }).refine(s => {
  const entered = s.enteredAt !== null && s.entryFill !== null;
  const exited = s.exitAt !== null && s.exitFill !== null && s.realizedReturnPct !== null;
  if (entered && Date.parse(s.enteredAt!) < Date.parse(s.publishedAt)) return false;
  if (exited && Date.parse(s.exitAt!) < Date.parse(s.enteredAt!)) return false;
  if (s.status === "PENDING" || s.status === "EXPIRED" || s.status === "INVALIDATED") return !entered && s.highestTarget === 0 && s.enteredAt === null && s.entryFill === null && s.exitAt === null && s.exitFill === null && s.realizedReturnPct === null;
  if (activeStatuses.has(s.status)) return entered && s.highestTarget === (s.status === "TP1" ? 1 : s.status === "TP2" ? 2 : 0) && !exited && s.exitAt === null && s.exitFill === null && s.realizedReturnPct === null;
  return entered && exited && (s.status === "TP3" ? s.highestTarget === 3 : s.highestTarget <= 2);
}, "Inconsistent simulated signal lifecycle");
const positionSchema = z.object({ quantity: finiteMoney.positive(), reserved: finiteMoney, entryCost: finiteMoney.nullable(), settled: z.boolean(), journal: z.string().max(10_000), signal: signalSchema }).refine(p => {
  if (p.settled === activeStatuses.has(p.signal.status)) return false;
  const plan = p.signal.setup.plan!;
  const reservation = p.quantity * plan.entry * (1 + plan.slippageBps / 10_000) * (1 + plan.feeBps / 10_000);
  if (Math.abs(p.reserved - reservation) > Math.max(1e-8, reservation * 1e-10)) return false;
  if (!p.signal.entryFill) return p.entryCost === null;
  const expected = p.quantity * p.signal.entryFill * (1 + p.signal.setup.plan!.feeBps / 10_000);
  return p.entryCost !== null && Math.abs(p.entryCost - expected) <= Math.max(1e-8, expected * 1e-10);
}, "Inconsistent portfolio accounting");
const accountSchema = z.object({ version: z.literal(1), initialCapital: finiteMoney.min(100), cash: finiteMoney, positions: z.array(positionSchema).max(2000) }).refine(account => {
  let expected = account.initialCapital;
  const identities = new Set<string>();
  for (const p of account.positions) {
    const identity = `${p.signal.setup.id}:${p.signal.publishedAt}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    if (p.entryCost !== null) expected -= p.entryCost;
    else if (!p.settled) expected -= p.reserved;
    if (p.settled && p.signal.exitFill !== null) expected += p.quantity * p.signal.exitFill * (1 - p.signal.setup.plan!.feeBps / 10_000);
  }
  return Math.abs(account.cash - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-10);
}, "Cash does not match the virtual portfolio ledger");
export function importPaperAccount(value: string): PaperAccount {
  if (value.length > 5_000_000) throw new Error("Portfolio file exceeds 5 MB.");
  return accountSchema.parse(JSON.parse(value)) as unknown as PaperAccount;
}
export function reservePosition(account: PaperAccount, setup: MarketSetup, riskPercent: number, at = new Date().toISOString()): PaperAccount {
  setupSchema.parse(setup);
  if (!Number.isFinite(account.cash) || !Number.isFinite(account.initialCapital) || account.cash < 0) throw new Error("Invalid virtual cash balance.");
  const plan = setup.plan;
  if (!plan || setup.action !== "BUY" || Date.parse(setup.expiresAt) <= Date.parse(at)) throw new Error("Only current qualified BUY plans can enter the simulator.");
  if (account.positions.some(p => !p.settled && p.signal.setup.symbol === setup.symbol && (p.signal.setup.timeframe ?? "1h") === (setup.timeframe ?? "1h"))) throw new Error("A simulation for this asset and horizon is already active.");
  if (account.positions.filter(p => !p.settled).length >= 10) throw new Error("Maximum 10 active spot simulations per virtual portfolio.");
  if (!Number.isFinite(riskPercent) || riskPercent < .1 || riskPercent > 5) throw new Error("Risk must be between 0.1% and 5%.");
  const fee = plan.feeBps / 10_000, slip = plan.slippageBps / 10_000;
  const entryCost = plan.entry * (1 + slip) * (1 + fee);
  const perUnitLoss = entryCost - plan.stopLoss * (1 - slip) * (1 - fee);
  if (perUnitLoss <= 0) throw new Error("Invalid stop distance.");
  const raw = Math.min(account.cash / entryCost, account.initialCapital * riskPercent / 100 / perUnitLoss);
  let quantity = roundToStep(raw, plan.stepSize);
  if (quantity * entryCost > account.cash || quantity * perUnitLoss > account.initialCapital * riskPercent / 100) quantity = roundToStep(quantity - plan.stepSize, plan.stepSize);
  const reserved = quantity * entryCost;
  if (![quantity, reserved].every(Number.isFinite) || quantity <= 0 || quantity * plan.entry < plan.minNotional || reserved > account.cash + 1e-8) throw new Error("Available cash is below the exchange minimum order size.");
  const signal: TrackedSignal = { setup: structuredClone(setup), publishedAt: at, status: "PENDING", enteredAt: null, entryFill: null, exitAt: null, exitFill: null, lastEvaluatedTime: 0, highestTarget: 0, realizedReturnPct: null, events: [] };
  const next = structuredClone(account);
  next.cash -= reserved;
  next.positions.unshift({ signal, quantity, reserved, entryCost: null, settled: false, journal: "" });
  return next;
}
export function reconcilePosition(account: PaperAccount, index: number, signal: TrackedSignal): PaperAccount {
  const next = structuredClone(account);
  const position = next.positions[index];
  if (!position || position.settled) return next;
  if (position.signal.setup.id !== signal.setup.id) throw new Error("Signal identity mismatch.");
  const fee = signal.setup.plan!.feeBps / 10_000;
  position.signal = signal;
  if (signal.entryFill !== null && position.entryCost === null) {
    position.entryCost = position.quantity * signal.entryFill * (1 + fee);
    next.cash += position.reserved - position.entryCost;
  }
  if (!activeStatuses.has(signal.status)) {
    next.cash += signal.exitFill !== null ? position.quantity * signal.exitFill * (1 - fee) : position.entryCost === null ? position.reserved : 0;
    position.settled = true;
  }
  return next;
}
/** Merge asynchronous market observations into the latest portfolio, preserving journals/new trades. */
export function applyPaperUpdates(account: PaperAccount, updates: TrackedSignal[]): PaperAccount {
  let next = account;
  for (const signal of updates) {
    const index = next.positions.findIndex(p => p.signal.setup.id === signal.setup.id && p.signal.publishedAt === signal.publishedAt);
    if (index < 0 || next.positions[index].signal.lastEvaluatedTime > signal.lastEvaluatedTime) continue;
    next = reconcilePosition(next, index, signal);
  }
  return next;
}
export function settlePaperPosition(account: PaperAccount, signalId: string, publishedAt: string, action: { kind: "cancel" } | { kind: "close"; quote: { symbol: string; price: number; asOf: string } }, at = new Date().toISOString()): PaperAccount {
  const index = account.positions.findIndex(p => p.signal.setup.id === signalId && p.signal.publishedAt === publishedAt);
  const position = account.positions[index];
  if (!position) throw new Error("Virtual position was not found.");
  if (position.settled) return account;
  const signal = structuredClone(position.signal);
  const plan = signal.setup.plan!;
  if (action.kind === "cancel") {
    if (signal.enteredAt !== null) throw new Error("The entry has already filled. Use Close virtual position.");
    signal.status = "INVALIDATED";
    signal.events.push({ id: `${signalId}:USER CANCEL`, signalId, type: "USER CANCEL", at, price: null, detail: "Unfilled research plan cancelled by the user. Reserved virtual cash refunded; no trade return recorded." });
  } else {
    const quote = action.quote;
    const age = Date.parse(at) - Date.parse(quote.asOf);
    if (!Number.isFinite(age) || age < -10_000 || age > 120_000 || quote.symbol !== signal.setup.symbol || !Number.isFinite(quote.price) || quote.price <= 0) throw new Error("A fresh Binance quote is required for a manual virtual exit.");
    if (signal.entryFill === null || signal.enteredAt === null) throw new Error("The virtual entry has not filled yet. Cancel the pending plan instead.");
    signal.exitFill = quote.price * (1 - plan.slippageBps / 10_000);
    signal.exitAt = at;
    signal.status = "CLOSED";
    signal.realizedReturnPct = (signal.exitFill * (1 - plan.feeBps / 10_000) / (signal.entryFill * (1 + plan.feeBps / 10_000)) - 1) * 100;
    signal.events.push({ id: `${signalId}:USER EXIT`, signalId, type: "USER EXIT", at, price: signal.exitFill, detail: "Manual virtual exit using a fresh public Binance quote. Exit slippage and fees included; original research levels preserved." });
  }
  return reconcilePosition(account, index, signal);
}
