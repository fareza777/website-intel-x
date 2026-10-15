import type { Candle, MarketSnapshot, SignalEvent, StoredState, TrackedSignal } from "./types";
export function emptyState(): StoredState { return { version: 1, updatedAt: "", snapshot: null, signals: [], alerts: [], analytics: null }; }
export const activeStatuses = new Set(["PENDING", "OPEN", "TP1", "TP2"]);
const marketKey = (setup: TrackedSignal["setup"]) => `${setup.symbol}:${setup.timeframe ?? "1h"}`;

export function publishSignals(state: StoredState, snapshot: MarketSnapshot, publicationAt = snapshot.generatedAt): StoredState {
  const next = structuredClone(state);
  next.snapshot = snapshot;
  next.updatedAt = publicationAt;
  const ids = new Set(next.signals.map(s => s.setup.id));
  const occupied = new Set(next.signals.filter(s => s.setup.action === "BUY" && activeStatuses.has(s.status)).map(s => marketKey(s.setup)));
  for (const setup of snapshot.setups) {
    if (setup.action === "NO TRADE" || !setup.plan || ids.has(setup.id) || occupied.has(marketKey(setup)) || Date.parse(setup.expiresAt) <= Date.parse(publicationAt)) continue;
    const waiting = next.signals.filter(s => marketKey(s.setup) === marketKey(setup) && s.setup.action === "WAIT" && activeStatuses.has(s.status));
    if (setup.action === "WAIT" && waiting.length) continue;
    if (setup.action === "BUY") for (const prior of waiting) {
      prior.status = "INVALIDATED";
      prior.events.push({ id: `${prior.setup.id}:SUPERSEDED`, signalId: prior.setup.id, type: "SUPERSEDED", at: publicationAt, price: null, detail: `Conditional research superseded by newly qualified BUY ${setup.id}. Original levels preserved; no retroactive fill.` });
    }
    const event: SignalEvent = { id: `${setup.id}:PUBLISHED`, signalId: setup.id, type: setup.action === "BUY" ? "PUBLISHED" : "CONDITIONAL", at: publicationAt, price: setup.plan.entry, detail: `${setup.symbol} ${setup.action === "BUY" ? "qualified spot research plan" : "conditional WAIT research (no simulated entry until a new qualified BUY is published)"} published. Score ${setup.score}/100 is rule agreement, not a win probability.` };
    next.signals.push({ setup: structuredClone(setup), publishedAt: publicationAt, status: "PENDING", enteredAt: null, entryFill: null, exitAt: null, exitFill: null, lastEvaluatedTime: 0, highestTarget: 0, realizedReturnPct: null, events: [event] });
    if (setup.action === "BUY") next.alerts.push(event);
    ids.add(setup.id);
    if (setup.action === "BUY") occupied.add(marketKey(setup));
  }
  next.alerts = uniqueEvents(next.alerts).slice(-200);
  return next;
}

export function uniqueEvents(events: SignalEvent[]): SignalEvent[] { return [...new Map(events.map(e => [e.id, e])).values()]; }

export function advanceSignal(original: TrackedSignal, candles: Candle[], now: number): TrackedSignal {
  const signal = structuredClone(original);
  const plan = signal.setup.plan;
  if (!plan || !activeStatuses.has(signal.status)) return signal;
  const published = Date.parse(signal.publishedAt);
  const expiry = Date.parse(signal.setup.expiresAt);
  const slip = plan.slippageBps / 10_000;
  const fee = plan.feeBps / 10_000;
  const holdingHours = signal.setup.holdingPeriodHours ?? 72;
  function event(type: string, at: number, price: number | null, detail: string) {
    signal.events = uniqueEvents([...signal.events, { id: `${signal.setup.id}:${type}`, signalId: signal.setup.id, type, at: new Date(at).toISOString(), price, detail }]);
  }
  function exit(price: number, at: number, stopped: boolean) {
    signal.exitFill = price * (1 - slip);
    signal.exitAt = new Date(at).toISOString();
    signal.status = stopped ? "STOPPED" : signal.highestTarget === 3 ? "TP3" : "CLOSED";
    signal.realizedReturnPct = ((signal.exitFill * (1 - fee)) / (signal.entryFill! * (1 + fee)) - 1) * 100;
    event(stopped ? "STOPPED" : "EXIT", at, signal.exitFill, stopped ? "Conservative stop-first fill; gap opens and exit costs included." : "Full position exited; both-side fees and slippage included.");
  }
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  for (const candle of sorted) {
    const openTime = candle.time;
    if (candle.closeTime >= now || openTime < published || candle.time <= signal.lastEvaluatedTime) continue;
    // Do not jump across missing hours and silently assume the unknown path.
    const expected = signal.lastEvaluatedTime ? signal.lastEvaluatedTime + 3_600_000 : Math.ceil(published / 3_600_000) * 3_600_000;
    if (candle.time > expected) {
      event("DATA GAP", now, null, "Outcome evaluation paused: missing hourly candles must be recovered before advancing.");
      break;
    }
    signal.lastEvaluatedTime = candle.time;
    if (!signal.enteredAt) {
      if (openTime >= expiry) { signal.status = "EXPIRED"; event("EXPIRED", expiry, null, "The entry was not reached before expiration."); break; }
      if (signal.setup.action === "WAIT") {
        if (candle.close <= plan.stopLoss) { signal.status = "INVALIDATED"; event("INVALIDATED", candle.closeTime, candle.close, "Conditional WAIT thesis invalidated before qualification. No simulated entry."); break; }
        continue;
      }
      if (candle.open <= plan.stopLoss) { signal.status = "INVALIDATED"; event("INVALIDATED", openTime, candle.open, "Market opened through invalidation before an entry could be established."); break; }
      if (candle.low <= plan.entry) {
        signal.entryFill = Math.min(candle.open, plan.entry) * (1 + slip);
        signal.enteredAt = new Date(openTime).toISOString();
        signal.status = "OPEN";
        event("ENTRY", openTime, signal.entryFill, "Simulated limit entry; hourly OHLC time, not a verified tick execution.");
        if (candle.low <= plan.stopLoss) exit(plan.stopLoss, candle.closeTime, true);
        // A target may precede the entry within this bar; never award it.
      }
    } else {
      if (candle.open <= plan.stopLoss || candle.low <= plan.stopLoss) exit(Math.min(candle.open, plan.stopLoss), candle.open <= plan.stopLoss ? openTime : candle.closeTime, true);
      else {
        for (let i = signal.highestTarget; i < plan.targets.length; i++) {
          if (candle.high < plan.targets[i].price) break;
          signal.highestTarget = i + 1;
          signal.status = `TP${i + 1}` as TrackedSignal["status"];
          event(`TP${i + 1}`, candle.closeTime, plan.targets[i].price, `Target ${i + 1} touched. Full position stays open until TP3, stop, or the ${holdingHours}-hour time exit.`);
        }
        if (signal.highestTarget === 3) exit(plan.targets[2].price, candle.closeTime, false);
        else if (candle.closeTime + 1 - Date.parse(signal.enteredAt) >= holdingHours * 3_600_000) exit(candle.close, candle.closeTime, false);
      }
    }
    if (!activeStatuses.has(signal.status)) break;
  }
  // An empty/gapped series cannot prove that an entry was missed.
  const coveredThroughExpiry = signal.lastEvaluatedTime + 3_600_000 >= expiry;
  if (signal.status === "PENDING" && !signal.enteredAt && now >= expiry && coveredThroughExpiry) {
    signal.status = "EXPIRED";
    event("EXPIRED", expiry, null, "Entry window closed. No execution recorded; return is unavailable.");
  }
  return signal;
}
