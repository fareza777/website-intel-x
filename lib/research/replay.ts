import type { Candle, MarketSetup, MarketSnapshot, StoredState, Timeframe } from "../types";
import { breadthOf, type MarketContext } from "../market/context";
import type { DerivativeDay } from "../market/derivatives";

export function derivativeMap(sources: ReplaySource[]): Record<string, DerivativeDay[]> | undefined {
  const entries = sources.filter(source => source.derivatives).map(source => [source.symbol, source.derivatives!] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
import type { CalibrationModel } from "../market/model";
import { MarketDataError, validateCandles } from "../market/binance";
import { analyzeSymbol, type SetupInput } from "../market/setup";
import { activeStatuses, advanceSignal, emptyState, executionInterval, executionIntervalMs, publishSignals } from "../tracking";
import { applyPaperUpdates, createPaperAccount, positionValue, reservePosition, type PaperAccount } from "../paper";
import type { ReplayTrade, ScannerValidationRow } from "./types";

const FRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];
const HOUR = 3_600_000;
export interface ReplaySource { symbol: string; baseAsset: string; tickSize: number; stepSize: number; minNotional: number; candles: Record<Timeframe, Candle[]>; derivatives?: DerivativeDay[] }
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
      equity += positionValue(position, mark);
    }
  }
  return equity;
}

export interface ReplayOptions {
  analyzer?: (input: SetupInput, timeframe: Timeframe, context?: MarketContext) => MarketSetup;
  capital?: number; riskPercent?: number;
  /** Frozen calibration model; undefined uses the bundled model and null disables it. */
  model?: CalibrationModel | null;
}

/** Cross-market context from the same closed inputs every symbol sees at this scan. */
export function replayContext(inputs: SetupInput[], model: CalibrationModel | null | undefined, derivatives?: Record<string, DerivativeDay[]>): MarketContext {
  const btc = inputs.find(input => input.symbol === "BTCUSDT");
  const breadth = Object.fromEntries(FRAMES.map(frame => [frame, breadthOf(inputs.map(input => input.candles[frame] ?? []))]).filter(([, value]) => value !== null));
  return { btc: btc?.candles, breadth, ...(derivatives ? { derivatives } : {}), ...(model === undefined ? {} : { model }) };
}

/** Reuses the real publication, signal lifecycle and local paper accounting engines. */
export function replaySymbol(source: ReplaySource, start: number, end: number, options: ReplayOptions = {}): ScannerValidationRow[] {
  return replayUniverse([source], start, end, options);
}

interface Ledger {
  source: ReplaySource; state: StoredState; known: Set<string>;
  wallets: Record<Timeframe, PaperAccount>; actions: Record<Timeframe, ScannerValidationRow["actions"]>;
  publication: Record<Timeframe, { buy: number; wait: number; unsized: number }>; curves: Record<Timeframe, { time: number; value: number }[]>;
  finals: Record<Timeframe, { expired: number; invalidated: number }>;
}

/** Every symbol is its own set of accounts; the universe only supplies shared BTC and breadth context. */
export function replayUniverse(sources: ReplaySource[], start: number, end: number, options: ReplayOptions = {}): ScannerValidationRow[] {
  if (![start, end].every(Number.isSafeInteger) || start > end || start % HOUR !== 17 * 60_000 || end % HOUR !== 17 * 60_000) throw new MarketDataError("Replay scans must use chronological hourly :17 timestamps");
  for (const source of sources) for (const frame of FRAMES) validateCandles(source.candles[frame], frame);
  const capital = options.capital ?? 10000, risk = options.riskPercent ?? 1, analyzer = options.analyzer ?? analyzeSymbol;
  if (!Number.isFinite(risk) || risk < .1 || risk > 5) throw new MarketDataError("Replay risk must be between 0.1% and 5% of initial capital");
  const per = <T,>(make: () => T) => Object.fromEntries(FRAMES.map(frame => [frame, make()])) as Record<Timeframe, T>;
  const ledgers: Ledger[] = sources.map(source => ({ source, state: emptyState(), known: new Set<string>(), wallets: per(() => createPaperAccount(capital)),
    actions: per(() => ({ BUY: 0, WAIT: 0, "NO TRADE": 0 })), publication: per(() => ({ buy: 0, wait: 0, unsized: 0 })),
    curves: per(() => [{ time: start - HOUR, value: capital }]), finals: per(() => ({ expired: 0, invalidated: 0 })) }));
  let scans = 0;
  const derivatives = derivativeMap(sources);
  for (let now = start; now <= end; now += HOUR) {
    scans++;
    for (const ledger of ledgers) {
      const { source } = ledger;
      ledger.state.snapshot = null;
      ledger.state.signals = ledger.state.signals.map(signal => {
        const interval = executionInterval(signal), duration = executionIntervalMs(signal);
        const first = signal.lastEvaluatedTime ? signal.lastEvaluatedTime + duration : Math.ceil(Date.parse(signal.publishedAt) / duration) * duration;
        const all = source.candles[interval];
        return advanceSignal(signal, all.slice(timeStart(all, first), closedEnd(all, now)), now);
      });
      if (ledger.state.signals.some(signal => signal.events.some(event => event.type === "DATA GAP"))) throw new MarketDataError("Replay outcome coverage contains a data gap");
      for (const frame of FRAMES) ledger.wallets[frame] = applyPaperUpdates(ledger.wallets[frame], ledger.state.signals.filter(signal => (signal.setup.timeframe ?? "1h") === frame && signal.setup.action === "BUY"));
    }
    const inputs = ledgers.map(ledger => historicalInput(ledger.source, now));
    const context = replayContext(inputs, options.model, derivatives);
    for (const [index, ledger] of ledgers.entries()) {
      const input = inputs[index];
      const setups = FRAMES.map(frame => analyzer(input, frame, context));
      for (const setup of setups) ledger.actions[setup.timeframe ?? "1h"][setup.action]++;
      const snapshot = { version: 1, generatedAt: new Date(now).toISOString(), setups: setups.filter(setup => !ledger.known.has(setup.id)) } as MarketSnapshot;
      const before = new Set(ledger.state.signals.map(signal => signal.setup.id));
      ledger.state = publishSignals(ledger.state, snapshot, snapshot.generatedAt);
      for (const signal of ledger.state.signals) {
        const frame = signal.setup.timeframe ?? "1h";
        if (!before.has(signal.setup.id)) {
          ledger.known.add(signal.setup.id);
          if (signal.setup.action === "BUY") {
            ledger.publication[frame].buy++;
            try { ledger.wallets[frame] = reservePosition(ledger.wallets[frame], signal.setup, risk, signal.publishedAt); }
            catch (error) {
              if (!(error instanceof Error) || error.message !== "Available cash is below the exchange minimum order size.") throw error;
              ledger.publication[frame].unsized++;
            }
          } else ledger.publication[frame].wait++;
        }
        if (!activeStatuses.has(signal.status) && signal.setup.action === "BUY") {
          if (signal.status === "EXPIRED") ledger.finals[frame].expired++;
          if (signal.status === "INVALIDATED") ledger.finals[frame].invalidated++;
        }
      }
      ledger.state.signals = ledger.state.signals.filter(signal => activeStatuses.has(signal.status));
      ledger.state.snapshot = null;
      for (const frame of FRAMES) {
        // Decision bars can be a day old; portfolio marks follow the execution feed.
        const mark = input.candles[frame === "15m" ? "15m" : "1h"]!.at(-1)?.close;
        if (!mark) throw new MarketDataError("Historical mark unavailable");
        ledger.curves[frame].push({ time: now, value: markedEquity(ledger.wallets[frame], mark) });
      }
    }
  }
  return ledgers.flatMap(ledger => FRAMES.map(frame => summarize(ledger, frame, scans, capital)));
}

function summarize(ledger: Ledger, frame: Timeframe, scans: number, capital: number): ScannerValidationRow {
  const account = ledger.wallets[frame]; const curve = ledger.curves[frame];
  const completed = account.positions.filter(p => p.settled && p.signal.exitFill !== null);
  const trades: ReplayTrade[] = completed.map(p => ({ id: p.signal.setup.id, publishedAt: p.signal.publishedAt, enteredAt: p.signal.enteredAt!, exitAt: p.signal.exitAt!,
    entryFill: p.signal.entryFill!, exitFill: p.signal.exitFill!, quantity: p.quantity,
    pnl: p.quantity * p.signal.exitFill! * (1 - p.signal.setup.plan!.feeBps / 10000) - p.entryCost!, returnPct: p.signal.realizedReturnPct!, status: p.signal.status,
    rMultiple: p.signal.realizedReturnPct! / p.signal.setup.plan!.riskPct, scaled: !!p.signal.partial })).sort((a, b) => a.exitAt.localeCompare(b.exitAt));
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
  const { publication, finals, actions } = ledger;
  return { symbol: ledger.source.symbol, timeframe: frame, scans, actions: actions[frame], publishedBuy: publication[frame].buy, publishedWait: publication[frame].wait,
    filled: account.positions.filter(p => p.signal.entryFill !== null).length, completed: trades.length,
    expired: finals[frame].expired, invalidated: finals[frame].invalidated, pending: account.positions.filter(p => !p.settled && !p.signal.enteredAt).length,
    open: account.positions.filter(p => !p.settled && p.signal.enteredAt).length, unsized: publication[frame].unsized,
    winRate: trades.length ? positive.length / trades.length * 100 : null, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancyPct: trades.length ? trades.reduce((sum, t) => sum + t.returnPct, 0) / trades.length : null, netReturnPct, maxDrawdownPct: drawdown,
    evidence: trades.length < 30 ? "insufficient" : netReturnPct > 0 && grossProfit > grossLoss ? "positive-sample" : "unfavorable",
    equity: curve.filter((_, i) => i === 0 || i === curve.length - 1 || i % 24 === 0).map(p => ({ time: new Date(p.time).toISOString(), value: p.value })), windows, trades };
}
