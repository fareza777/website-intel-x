import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Candle, Timeframe } from "../lib/types";
import { getExchangeSymbols, getExchangeTime, INTERVAL_MS } from "../lib/market/binance";
import { STRATEGY_VERSION } from "../lib/market/policy";
import { history } from "../lib/research/history";
import type { ReplaySource } from "../lib/research/replay";
import { buildModel, collectCandidates, TIMEFRAMES } from "../lib/research/training";

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Predeclared liquid majors with multi-year Binance history; not chosen by backtest results. */
export const TRAINING_UNIVERSE = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT",
  "DOTUSDT", "TRXUSDT", "BCHUSDT", "NEARUSDT", "ATOMUSDT", "UNIUSDT", "FILUSDT", "INJUSDT", "AAVEUSDT", "ETCUSDT"];

async function atomic(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 1)); await rename(tmp, file); }

function option(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value)) throw new Error(`${name} requires an integer`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const trainDays = option(args, "--train-days", 365), holdoutDays = option(args, "--holdout-days", 90);
  if (trainDays < 60 || trainDays > 730 || holdoutDays < 30 || holdoutDays > 180) throw new Error("Usage: train-model.ts [--train-days 60..730] [--holdout-days 30..180] [--output lib/market/model.json]");
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : path.join("lib", "market", "model.json");
  const directory = process.env.DATA_DIRECTORY || path.join(process.cwd(), "data");
  const now = await getExchangeTime();
  let end = Math.floor(now / HOUR) * HOUR + 17 * 60_000; if (end > now) end -= HOUR;
  // Training data stops where the scanner replay window starts, so that replay stays out-of-sample.
  const replayStart = end - holdoutDays * DAY + HOUR;
  const trainStart = replayStart - trainDays * DAY;
  const symbols = await getExchangeSymbols();
  const sources: ReplaySource[] = [], failures: { symbol: string; message: string }[] = [];
  for (const symbol of TRAINING_UNIVERSE) {
    try {
      const market = symbols.find(item => item.symbol === symbol && item.spotAllowed && item.status === "TRADING");
      if (!market) throw new Error("Market metadata unavailable");
      const candles = {} as Record<Timeframe, Candle[]>;
      for (const frame of TIMEFRAMES) candles[frame] = await history(symbol, frame, trainStart - 270 * INTERVAL_MS[frame], replayStart, 80);
      sources.push({ ...market, candles });
      console.log(JSON.stringify({ downloaded: symbol, bars: Object.fromEntries(TIMEFRAMES.map(frame => [frame, candles[frame].length])) }));
    } catch (error) { failures.push({ symbol, message: error instanceof Error ? error.message : "unavailable" }); console.error(`${symbol}: training data unavailable`); }
  }
  if (sources.length < 8 || !sources.some(source => source.symbol === "BTCUSDT")) throw new Error("At least eight markets including BTC are required for training");
  const started = Date.now();
  const candidates = collectCandidates(sources, trainStart, replayStart - HOUR, replayStart, (done, total) => console.log(JSON.stringify({ progress: `${done}/${total}`, seconds: Math.round((Date.now() - started) / 1000) })));
  console.log(JSON.stringify({ candidates: Object.fromEntries(TIMEFRAMES.map(tf => [tf, candidates.filter(c => c.timeframe === tf).length])), seconds: Math.round((Date.now() - started) / 1000) }));
  const { model, profiles } = buildModel(candidates, { strategyVersion: STRATEGY_VERSION, generatedAt: new Date(now).toISOString(), trainedFrom: new Date(trainStart).toISOString(),
    trainedThrough: new Date(replayStart).toISOString(), universe: sources.map(source => source.symbol) });
  await atomic(output, model);
  await atomic(path.join(directory, "training-report.json"), { generatedAt: model.generatedAt, trainedFrom: model.trainedFrom, trainedThrough: model.trainedThrough, failures, profiles,
    horizons: Object.fromEntries(Object.entries(model.horizons).map(([tf, h]) => [tf, { exitProfile: h.exitProfile, minimumEdgeR: h.minimumEdgeR, validated: h.validated, samples: h.samples, wins: h.wins, avgWinR: h.avgWinR, avgLossR: h.avgLossR, validation: h.validation, reason: h.reason }])) });
  for (const [tf, h] of Object.entries(model.horizons)) console.log(JSON.stringify({ horizon: tf, validated: h.validated, exitProfile: h.exitProfile, minimumEdgeR: h.minimumEdgeR, samples: h.samples, auc: h.validation.auc, allMeanR: h.validation.allMeanR, selected: h.validation.selected, selectedMeanR: h.validation.selectedMeanR, selectedWinRate: h.validation.selectedWinRate }));
  for (const [tf, list] of Object.entries(profiles)) for (const p of list) console.log(JSON.stringify({ horizon: tf, ...p }));
  console.log(`MODEL_JSON ${JSON.stringify(model)}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Training failed safely"); process.exitCode = 1; });
