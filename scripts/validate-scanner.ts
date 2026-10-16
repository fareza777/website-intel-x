import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Candle, Timeframe } from "../lib/types";
import { getCandles, getExchangeSymbols, getExchangeTime, INTERVAL_MS, validateCandles } from "../lib/market/binance";
import { DEFAULT_COSTS } from "../lib/market/risk";
import { STRATEGY_VERSION } from "../lib/market/setup";
import { replaySymbol, type ReplaySource } from "../lib/research/replay";
import type { ScannerValidationReport } from "../lib/research/types";

const HOUR = 3_600_000, DAY = 24 * HOUR;
async function atomic(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(value)); await rename(tmp, file); }
async function history(symbol: string, frame: Timeframe, start: number, end: number): Promise<Candle[]> {
  const duration = INTERVAL_MS[frame]; let cursor = Math.floor(start / duration) * duration;
  const result: Candle[] = [];
  for (let page = 0; page < 32 && cursor < end; page++) {
    const candles = (await getCandles(symbol, frame, 1000, cursor)).filter(c => c.closeTime < end);
    if (!candles.length) break;
    result.push(...candles); const next = candles.at(-1)!.time + duration;
    if (next <= cursor) throw new Error("Historical pagination did not advance"); cursor = next;
  }
  validateCandles(result, frame);
  if (!result.length || result[0].time > Math.floor(start / duration) * duration || end - result.at(-1)!.closeTime > duration) throw new Error(`Incomplete ${frame} historical coverage`);
  return result;
}
async function main() {
  const args = process.argv.slice(2); let days = 90;
  for (let i = 0; i < args.length; i++) { if (args[i] !== "--days" || !args[i + 1]) throw new Error("Usage: validate-scanner.ts [--days 30..180]"); days = Number(args[++i]); }
  if (!Number.isInteger(days) || days < 30 || days > 180) throw new Error("Validation days must be from 30 to 180");
  const directory = process.env.DATA_DIRECTORY || path.join(process.cwd(), "data");
  const now = await getExchangeTime();
  let end = Math.floor(now / HOUR) * HOUR + 17 * 60_000; if (end > now) end -= HOUR;
  const start = end - days * DAY + HOUR;
  const code = await Promise.all(["lib/market/setup.ts", "lib/market/entry.ts", "lib/market/policy.ts", "lib/market/indicators.ts", "lib/market/risk.ts", "lib/market/structure.ts", "lib/market/volume.ts", "lib/tracking.ts", "lib/paper.ts", "lib/research/replay.ts"].map(file => readFile(file)));
  const hash = createHash("sha256"); for (const file of code) hash.update(file);
  const report: ScannerValidationReport = { version: 1, strategyVersion: STRATEGY_VERSION, codeHash: hash.digest("hex"), generatedAt: new Date(now).toISOString(), start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"], scanIntervalHours: 1, assumedPublicationMinute: 17, closedWindow: 259,
    capitalPerAccount: 10000, initialCapitalRiskPct: 1, ...DEFAULT_COSTS, rows: [], failures: [], notes: [
      "Replay of the actual analyzeSymbol, publishSignals, advanceSignal, reservePosition and applyPaperUpdates engines. cx-spot-4 uses explicit breakout/reclaim or EMA21 pullback entries, supporting (non-veto) indicators and horizon-specific risk/volatility policies. Rules were fixed before replay; no parameter search.",
      "Predeclared BTC/ETH/SOL/INJ selection. INJ is the user-reported high-score qualification case, not a selection based on backtest profitability. Each symbol/horizon is a separate 10,000 USDT account. There is no aggregate shared-cash portfolio return. Risk budget is 1% of initial account capital, limited by available cash and current exchange lot/minimum filters.",
      "Hourly scans at :17 are an assumed publication time. Real GitHub jobs publish later and can be delayed. Each input uses 259 closed bars per frame, matching 260 live klines minus the unfinished bar; analyzeSymbol applies its own decision-close context cutoff.",
      "Historical 24h ticker volume/change is reconstructed from the last 24 contiguous closed hourly bars. This approximates, rather than reproduces, Binance rolling intrabar ticker statistics at :17. Current exchange filters and a fixed present-day universe introduce historical-filter and selection limitations.",
      "New entries ignore any execution candle already underway at publication. 15M uses subsequent full 15-minute bars; other horizons use subsequent full hourly bars. OHLC fills are assumed, not trade-level verified fills.",
      "Both-side fee/slippage, adverse stop gaps, known opening targets, stop-first intrabar ambiguity, no entry-bar target credit, expiry and horizon holding limits use production rules. TP1/2 are milestones; no partial cash is credited.",
      "Accounts and original positions continue through three chronological reporting windows; no boundary forces an exit. Completed trade counts belong to their exit window. Return and drawdown use hourly scan marks after estimated liquidation costs; open exposure remains unrealized.",
      "Profit factor uses net realized currency P/L. Expectancy is mean net completed-trade return percentage. Undefined statistics are null. Equity curves are sampled daily for compact storage; drawdown uses every hourly mark.",
      "This is retrospective research with fixed current parameters, no optimization, and an empty starting ledger. The chronological thirds are descriptive, not untouched out-of-sample or live evidence. Fewer than 30 completed trades is a sample-size warning, not a formal significance test. Positive history is not proof of future profit.",
    ] };
  const symbols = await getExchangeSymbols();
  for (const symbol of report.symbols) {
    try {
      const market = symbols.find(item => item.symbol === symbol && item.spotAllowed && item.status === "TRADING");
      if (!market) throw new Error("Market metadata unavailable");
      const candles = {} as Record<Timeframe, Candle[]>;
      // Sequential, paced requests avoid launching a historical-data burst.
      for (const frame of ["15m", "1h", "4h", "1d"] as Timeframe[]) candles[frame] = await history(symbol, frame, start - 270 * INTERVAL_MS[frame], end);
      const source: ReplaySource = { ...market, candles };
      await atomic(path.join(directory, "validation-candles", `${symbol}.json`), { end: report.end, source });
      const rows = replaySymbol(source, start, end);
      report.rows.push(...rows);
      console.log(JSON.stringify({ symbol, completed: rows.reduce((sum, row) => sum + row.completed, 0), rows: rows.map(row => ({ timeframe: row.timeframe, publishedBuy: row.publishedBuy, completed: row.completed, netReturnPct: row.netReturnPct, evidence: row.evidence })) }));
    } catch (error) { report.failures.push({ symbol, message: error instanceof Error ? error.message : "Historical validation unavailable" }); console.error(`${symbol}: validation unavailable`); }
  }
  if (!report.rows.length) throw new Error("No complete real-data scanner validation could be produced; prior report preserved");
  await atomic(path.join(directory, "scanner-validation.json"), report);
  console.log(JSON.stringify({ version: report.strategyVersion, generatedAt: report.generatedAt, rows: report.rows.length, failed: report.failures.length, days }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Validation failed safely"); process.exitCode = 1; });
