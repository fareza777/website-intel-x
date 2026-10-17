import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Candle, Timeframe } from "../lib/types";
import { getExchangeSymbols, getExchangeTime, INTERVAL_MS } from "../lib/market/binance";
import { history } from "../lib/research/history";
import { fetchDerivativeDays, latestUsableDay } from "../lib/market/derivatives";
import { BUNDLED_MODEL } from "../lib/market/bundled-model";
import { summarizeHorizon } from "../lib/research/stats";
import { backtestRotation, DEFAULT_ROTATION } from "../lib/market/rotation";
import { DEFAULT_COSTS } from "../lib/market/risk";
import { STRATEGY_VERSION } from "../lib/market/setup";
import { replayUniverse, type ReplaySource } from "../lib/research/replay";
import type { ScannerValidationReport } from "../lib/research/types";

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Predeclared liquid majors plus INJ (the original reported case); not selected by replay results. */
const REPLAY_UNIVERSE = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT", "NEARUSDT", "INJUSDT"];
async function atomic(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(value)); await rename(tmp, file); }
async function main() {
  const args = process.argv.slice(2); let days = 90;
  for (let i = 0; i < args.length; i++) { if (args[i] !== "--days" || !args[i + 1]) throw new Error("Usage: validate-scanner.ts [--days 30..180]"); days = Number(args[++i]); }
  if (!Number.isInteger(days) || days < 30 || days > 180) throw new Error("Validation days must be from 30 to 180");
  const directory = process.env.DATA_DIRECTORY || path.join(process.cwd(), "data");
  const now = await getExchangeTime();
  let end = Math.floor(now / HOUR) * HOUR + 17 * 60_000; if (end > now) end -= HOUR;
  const start = end - days * DAY + HOUR;
  const code = await Promise.all(["lib/market/setup.ts", "lib/market/entry.ts", "lib/market/policy.ts", "lib/market/indicators.ts", "lib/market/risk.ts", "lib/market/structure.ts", "lib/market/volume.ts", "lib/market/features.ts", "lib/market/context.ts", "lib/market/model.ts", "lib/market/model.json", "lib/market/boosting.ts", "lib/market/derivatives.ts", "lib/market/derivative-keys.ts", "lib/market/rotation.ts", "lib/tracking.ts", "lib/paper.ts", "lib/research/replay.ts"].map(file => readFile(file)));
  const hash = createHash("sha256"); for (const file of code) hash.update(file);
  const report: ScannerValidationReport = { version: 1, strategyVersion: STRATEGY_VERSION, codeHash: hash.digest("hex"), generatedAt: new Date(now).toISOString(), start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    symbols: REPLAY_UNIVERSE,
    model: { version: BUNDLED_MODEL.version, trainedThrough: BUNDLED_MODEL.trainedThrough, outOfSample: BUNDLED_MODEL.trainedThrough !== null && Date.parse(BUNDLED_MODEL.trainedThrough) <= start }, scanIntervalHours: 1, assumedPublicationMinute: 17, closedWindow: 259,
    capitalPerAccount: 10000, initialCapitalRiskPct: 1, ...DEFAULT_COSTS, rows: [], failures: [], notes: [
      "Replay of the actual analyzeSymbol, publishSignals, advanceSignal, reservePosition and applyPaperUpdates engines. cx-spot-5 adds a BTC/breadth regime gate, a frozen calibrated edge model, volatility/beta position sizing, and TP1 scale-out with breakeven and ATR trailing exits.",
      "The model and its exit profiles were trained only on data that ends before this replay window starts (see model.trainedThrough and model.outOfSample). The replay is therefore out-of-sample for the model; it is still a single historical period.",
      "Predeclared twelve-market universe of liquid majors plus INJ (the user-reported case). Each symbol/horizon is a separate 10,000 USDT account; BTC trend and breadth come from the same universe at each scan. Risk budget is 1% of initial capital, reduced by volatility, beta and 15M guidance.",
      "Hourly scans at :17 are an assumed publication time. Each input uses 259 closed bars per frame, matching 260 live klines minus the unfinished bar. Historical 24h ticker volume/change is reconstructed from 24 closed hourly bars. Current exchange filters and a fixed present-day universe introduce selection limitations.",
      "New entries ignore any execution candle already underway at publication. OHLC fills are assumed, not trade-level verified. Stops win ambiguous bars, including a same-bar TP1 followed by a dip to breakeven. The scaled-out portion is reported in one quantity-weighted exit price.",
      "Summaries pool every symbol's completed trades per horizon. Expectancy is in R (net return divided by planned costed risk). The 90% bootstrap interval and the 95th-percentile Monte Carlo drawdown (shuffled trade order) describe sampling uncertainty; 'validated' needs at least 100 trades and a positive lower bound.",
      "Positive history is not proof of future profit. Fewer than 30 completed trades in a row is a sample-size warning, not a formal significance test.",
    ] };
  const symbols = await getExchangeSymbols();
  const sources: ReplaySource[] = [];
  for (const symbol of report.symbols) {
    try {
      const market = symbols.find(item => item.symbol === symbol && item.spotAllowed && item.status === "TRADING");
      if (!market) throw new Error("Market metadata unavailable");
      const candles = {} as Record<Timeframe, Candle[]>;
      // Sequential, paced requests avoid launching a historical-data burst.
      for (const frame of ["15m", "1h", "4h", "1d"] as Timeframe[]) candles[frame] = await history(symbol, frame, start - 270 * INTERVAL_MS[frame], end);
      const derivatives = await fetchDerivativeDays(symbol, latestUsableDay(start) - 8 * DAY, latestUsableDay(end), { concurrency: 16 });
      sources.push({ ...market, candles, derivatives });
    } catch (error) { report.failures.push({ symbol, message: error instanceof Error ? error.message : "Historical validation unavailable" }); console.error(`${symbol}: validation unavailable`); }
  }
  if (sources.length) {
    report.rows = replayUniverse(sources, start, end);
    report.rotation = backtestRotation(Object.fromEntries(sources.map(source => [source.symbol, source.candles["1d"]])), start, end, BUNDLED_MODEL.rotation?.params ?? DEFAULT_ROTATION);
    console.log(JSON.stringify({ rotation: { ...report.rotation, equity: undefined } }));
    report.summaries = (["15m", "1h", "4h", "1d"] as Timeframe[]).map(frame => summarizeHorizon(frame, report.rows.filter(row => row.timeframe === frame).flatMap(row => row.trades)));
    for (const row of report.rows) console.log(JSON.stringify({ symbol: row.symbol, timeframe: row.timeframe, publishedBuy: row.publishedBuy, completed: row.completed, winRate: row.winRate, profitFactor: row.profitFactor, netReturnPct: row.netReturnPct, maxDrawdownPct: row.maxDrawdownPct }));
    for (const summary of report.summaries) console.log(JSON.stringify({ ...summary, histogram: summary.histogram.map(bin => bin.count) }));
  }
  if (!report.rows.length) throw new Error("No complete real-data scanner validation could be produced; prior report preserved");
  await atomic(path.join(directory, "scanner-validation.json"), report);
  console.log(JSON.stringify({ version: report.strategyVersion, generatedAt: report.generatedAt, rows: report.rows.length, failed: report.failures.length, days }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Validation failed safely"); process.exitCode = 1; });
