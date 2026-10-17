import { z } from "zod";
import type { ScannerValidationReport } from "./types";
const finite = z.number().finite(), count = finite.int().nonnegative().max(100_000), date = z.iso.datetime();
export const scannerReportSchema: z.ZodType<ScannerValidationReport> = z.object({
  version: z.literal(1), strategyVersion: z.string().min(1).max(80), codeHash: z.string().regex(/^[a-f0-9]{64}$/), generatedAt: date, start: date, end: date,
  symbols: z.array(z.string().regex(/^[A-Z0-9]{1,26}USDT$/)).max(20), scanIntervalHours: z.literal(1), assumedPublicationMinute: z.literal(17), closedWindow: z.literal(259),
  capitalPerAccount: finite.min(100).max(1e9), initialCapitalRiskPct: finite.min(.1).max(5), feeBps: finite.min(0).max(1000), slippageBps: finite.min(0).max(1000),
  rows: z.array(z.object({ symbol: z.string().max(30), timeframe: z.enum(["15m", "1h", "4h", "1d"]), scans: count,
    actions: z.object({ BUY: count, WAIT: count, "NO TRADE": count }), publishedBuy: count, publishedWait: count, filled: count, completed: count, expired: count, invalidated: count, pending: count, open: count, unsized: count,
    winRate: finite.min(0).max(100).nullable(), profitFactor: finite.min(0).nullable(), expectancyPct: finite.nullable(), netReturnPct: finite, maxDrawdownPct: finite.min(0).max(100),
    evidence: z.enum(["insufficient", "positive-sample", "unfavorable"]), equity: z.array(z.object({ time: date, value: finite.nonnegative() })).max(1000),
    windows: z.array(z.object({ start: date, end: date, netReturnPct: finite, completed: count })).length(3),
    trades: z.array(z.object({ id: z.string().max(200), publishedAt: date, enteredAt: date, exitAt: date, entryFill: finite.positive(), exitFill: finite.positive(), quantity: finite.positive(), pnl: finite, returnPct: finite, status: z.string().max(30), rMultiple: finite.optional(), scaled: z.boolean().optional() })).max(10000),
  }).refine(row => row.completed === row.trades.length && row.completed <= row.filled && row.filled <= row.publishedBuy, "Inconsistent replay trade counts")).max(80),
  summaries: z.array(z.object({ timeframe: z.enum(["15m", "1h", "4h", "1d"]), trades: count, winRate: finite.min(0).max(100).nullable(), profitFactor: finite.min(0).nullable(), expectancyR: finite.nullable(),
    ciLowR: finite.nullable(), ciHighR: finite.nullable(), drawdownR95: finite.min(0).nullable(), exitReasons: z.object({ stopped: count, trail: count, target: count, time: count }),
    histogram: z.array(z.object({ low: finite.nullable(), high: finite.nullable(), count })).max(20), validated: z.boolean() })).max(4).optional(),
  model: z.object({ version: z.string().max(80), trainedThrough: date.nullable(), outOfSample: z.boolean() }).optional(),
  failures: z.array(z.object({ symbol: z.string().max(30), message: z.string().max(2000) })).max(20), notes: z.array(z.string().max(3000)).max(40),
}).refine(report => Date.parse(report.end) >= Date.parse(report.start) && Date.parse(report.generatedAt) >= Date.parse(report.end), "Invalid replay time window");
