import type { Candle, MarketSnapshot, Timeframe } from "../types";
import { MarketDataError, validateCandles } from "../market/binance";
import { analyzeSymbol, type SetupInput } from "../market/setup";
import { activeStatuses, advanceSignal, emptyState, executionInterval, executionIntervalMs, publishSignals } from "../tracking";
import { applyPaperUpdates, createPaperAccount, reservePosition, type PaperAccount } from "../paper";
import type { ReplayTrade, ScannerValidationRow } from "./types";

const FRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];
const HOUR = 3_600_000;
export interface ReplaySource { symbol: string; baseAsset: string; tickSize: number; stepSize: number; minNotional: number; candles: Record<Timeframe, Candle[]> }
function closedEnd(candles: Candle[], now: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].closeTime < now) lo = mid + 1; else hi = mid; }
  return lo;
}
function timeStart(candles: Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Match the normal :17 live fetch: 260 raw klines minus the unfinished bar. */
export function historicalInput(source: ReplaySource, now: number): SetupInput {
  if (!Number.isFinite(now)) throw new MarketDataError("Invalid replay timestamp");
  const candles = Object.fromEntries(FRAMES.map(frame => {
    const all = source.candles[frame], end = closedEnd(all, now);
    return [frame, all.slice(Math.max(0, end - 259), end)];
  })) as Record<Timeframe, Candle[]>;
  const daily = candles["1h"].slice(-24);
  if (daily.length < 24) throw new MarketDataError("24 closed hours are required for historical ticker reconstruction");
  validateCandles(daily, "1h");
  return { symbol: source.symbol, baseAsset: source.baseAsset, tickSize: source.tickSize, stepSize: source.stepSize, minNotional: source.minNotional,
    now, candles, quoteVolume24h: daily.reduce((sum, c) => sum + c.quoteVolume, 0), change24h: (daily.at(-1)!.close / daily[0].open - 1) * 100 };
}
export function markedEquity(account: PaperAccount, mark: number): number {
  let equity = account.cash;
  for (const position of account.positions) {
    if (position.settled) continue;
    if (!position.signal.enteredAt) equity += position.reserved;
    else {
      if (!Number.isFinite(mark) || mark <= 0) throw new MarketDataError("Valid historical mark is required for an open position");
      const plan = position.signal.setup.plan!;
      equity += position.quantity * mark * (1 - plan.slippageBps / 10000) * (1 - plan.feeBps / 10000);
    }
  }
  return equity;
}

/** Reuses the real publication, signal lifecycle and local paper accounting engines. */
export function replaySymbol(source: ReplaySource, start: number, end: number, options: { analyzer?: typeof analyzeSymbol; capital?: number; riskPercent?: number } = {}): ScannerValidationRow[] {
  if (![start, end].every(Number.isSafeInteger) || start > end || start % HOUR !== 17 * 60_000 || end % HOUR !== 17 * 60_000) throw new MarketDataError("Replay scans must use chronological hourly :17 timestamps");
  for (const frame of FRAMES) validateCandles(source.candles[frame], frame);
  const capital = options.capital ?? 10000, risk = options.riskPercent ?? 1, analyzer = options.analyzer ?? analyzeSymbol;
  if (!Number.isFinite(risk) || risk < .1 || risk > 5) throw new MarketDataError("Replay risk must be between 0.1% and 5% of initial capital");
  const wallets = Object.fromEntries(FRAMES.map(frame => [frame, createPaperAccount(capital)])) as Record<Timeframe, PaperAccount>;
  const actions = Object.fromEntries(FRAMES.map(frame => [frame, { BUY: 0, WAIT: 0, "NO TRADE": 0 }])) as Record<Timeframe, ScannerValidationRow["actions"]>;
  const publication = Object.fromEntries(FRAMES.map(frame => [frame, { buy: 0, wait: 0, unsized: 0 }])) as Record<Timeframe, { buy: number; wait: number; unsized: number }>;
  const curves = Object.fromEntries(FRAMES.map(frame => [frame, [{ time: start - HOUR, value: capital }]])) as Record<Timeframe, { time: number; value: number }[]>;
  const finals: Record<Timeframe, { expired: number; invalidated: number }> = { "15m": { expired: 0, invalidated: 0 }, "1h": { expired: 0, invalidated: 0 }, "4h": { expired: 0, invalidated: 0 }, "1d": { expired: 0, invalidated: 0 } };
  const known = new Set<string>(); let state = emptyState(); let scans = 0;
  for (let now = start; now <= end; now += HOUR) {
    scans++;
    state.snapshot = null;
    state.signals = state.signals.map(signal => {
      const interval = executionInterval(signal), duration = executionIntervalMs(signal);
      const first = signal.lastEvaluatedTime ? signal.lastEvaluatedTime + duration : Math.ceil(Date.parse(signal.publishedAt) / duration) * duration;
      const all = source.candles[interval];
      return advanceSignal(signal, all.slice(timeStart(all, first), closedEnd(all, now)), now);
    });
    if (state.signals.some(signal => signal.events.some(event => event.type === "DATA GAP"))) throw new MarketDataError("Replay outcome coverage contains a data gap");
    for (const frame of FRAMES) wallets[frame] = applyPaperUpdates(wallets[frame], state.signals.filter(signal => (signal.setup.timeframe ?? "1h") === frame && signal.setup.action === "BUY"));
    const input = historicalInput(source, now);
    const setups = FRAMES.map(frame => analyzer(input, frame));
    for (const setup of setups) actions[setup.timeframe ?? "1h"][setup.action]++;
    const snapshot = { version: 1, generatedAt: new Date(now).toISOString(), setups: setups.filter(setup => !known.has(setup.id)) } as MarketSnapshot;
    const before = new Set(state.signals.map(signal => signal.setup.id));
    state = publishSignals(state, snapshot, snapshot.generatedAt);
    for (const signal of state.signals) {
      const frame = signal.setup.timeframe ?? "1h";
      if (!before.has(signal.setup.id)) {
        known.add(signal.setup.id);
        if (signal.setup.action === "BUY") {
          publication[frame].buy++;
          try { wallets[frame] = reservePosition(wallets[frame], signal.setup, risk, signal.publishedAt); }
          catch (error) {
            if (!(error instanceof Error) || error.message !== "Available cash is below the exchange minimum order size.") throw error;
            publication[frame].unsized++;
          }
        } else publication[frame].wait++;
      }
      if (!activeStatuses.has(signal.status) && signal.setup.action === "BUY") {
        if (signal.status === "EXPIRED") finals[frame].expired++;
        if (signal.status === "INVALIDATED") finals[frame].invalidated++;
      }
    }
    state.signals = state.signals.filter(signal => activeStatuses.has(signal.status));
    state.snapshot = null;
    for (const frame of FRAMES) {
      // Decision bars can be a day old; portfolio marks follow the execution feed.
      const mark = input.candles[frame === "15m" ? "15m" : "1h"]!.at(-1)?.close;
      if (!mark) throw new MarketDataError("Historical mark unavailable");
      curves[frame].push({ time: now, value: markedEquity(wallets[frame], mark) });
    }
  }
  return FRAMES.map(frame => {
    const account = wallets[frame]; const curve = curves[frame];
    const completed = account.positions.filter(p => p.settled && p.signal.exitFill !== null);
    const trades: ReplayTrade[] = completed.map(p => ({ id: p.signal.setup.id, publishedAt: p.signal.publishedAt, enteredAt: p.signal.enteredAt!, exitAt: p.signal.exitAt!,
      entryFill: p.signal.entryFill!, exitFill: p.signal.exitFill!, quantity: p.quantity,
      pnl: p.quantity * p.signal.exitFill! * (1 - p.signal.setup.plan!.feeBps / 10000) - p.entryCost!, returnPct: p.signal.realizedReturnPct!, status: p.signal.status })).sort((a, b) => a.exitAt.localeCompare(b.exitAt));
    const positive = trades.filter(t => t.pnl > 0), negative = trades.filter(t => t.pnl < 0);
    const grossProfit = positive.reduce((sum, t) => sum + t.pnl, 0), grossLoss = -negative.reduce((sum, t) => sum + t.pnl, 0);
    let peak = capital, drawdown = 0;
    for (const point of curve) { peak = Math.max(peak, point.value); drawdown = Math.max(drawdown, (peak - point.value) / peak * 100); }
    const netReturnPct = (curve.at(-1)!.value / capital - 1) * 100;
    const windows = Array.from({ length: 3 }, (_, i) => {
      const first = Math.floor(i * (curve.length - 1) / 3), last = Math.floor((i + 1) * (curve.length - 1) / 3);
      return { start: new Date(curve[first].time).toISOString(), end: new Date(curve[last].time).toISOString(), netReturnPct: (curve[last].value / curve[first].value - 1) * 100,
        completed: trades.filter(t => Date.parse(t.exitAt) > curve[first].time && Date.parse(t.exitAt) <= curve[last].time).length };
    });
    return { symbol: source.symbol, timeframe: frame, scans, actions: actions[frame], publishedBuy: publication[frame].buy, publishedWait: publication[frame].wait,
      filled: account.positions.filter(p => p.signal.entryFill !== null).length, completed: trades.length,
      expired: finals[frame].expired, invalidated: finals[frame].invalidated, pending: account.positions.filter(p => !p.settled && !p.signal.enteredAt).length,
      open: account.positions.filter(p => !p.settled && p.signal.enteredAt).length, unsized: publication[frame].unsized,
      winRate: trades.length ? positive.length / trades.length * 100 : null, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      expectancyPct: trades.length ? trades.reduce((sum, t) => sum + t.returnPct, 0) / trades.length : null, netReturnPct, maxDrawdownPct: drawdown,
      evidence: trades.length < 30 ? "insufficient" : netReturnPct > 0 && grossProfit > grossLoss ? "positive-sample" : "unfavorable",
      equity: curve.filter((_, i) => i === 0 || i === curve.length - 1 || i % 24 === 0).map(p => ({ time: new Date(p.time).toISOString(), value: p.value })), windows, trades };
  });
}
