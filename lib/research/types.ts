import type { Timeframe } from "../types";
export interface ReplayTrade { id: string; publishedAt: string; enteredAt: string; exitAt: string; entryFill: number; exitFill: number; quantity: number; pnl: number; returnPct: number; status: string; rMultiple?: number; scaled?: boolean }
export interface ScannerValidationRow {
  symbol: string; timeframe: Timeframe; scans: number; actions: Record<"BUY" | "WAIT" | "NO TRADE", number>;
  publishedBuy: number; publishedWait: number; filled: number; completed: number; expired: number; invalidated: number; pending: number; open: number; unsized: number;
  winRate: number | null; profitFactor: number | null; expectancyPct: number | null; netReturnPct: number; maxDrawdownPct: number;
  evidence: "insufficient" | "positive-sample" | "unfavorable";
  equity: { time: string; value: number }[];
  windows: { start: string; end: string; netReturnPct: number; completed: number }[];
  trades: ReplayTrade[];
}
export interface ScannerValidationReport {
  version: 1; strategyVersion: string; codeHash: string; generatedAt: string; start: string; end: string;
  symbols: string[]; scanIntervalHours: 1; assumedPublicationMinute: 17; closedWindow: 259;
  capitalPerAccount: number; initialCapitalRiskPct: number; feeBps: number; slippageBps: number;
  rows: ScannerValidationRow[];
  /** cx-spot-5: pooled per-horizon statistics and the frozen model's out-of-sample status. */
  summaries?: HorizonSummary[];
  model?: { version: string; trainedThrough: string | null; outOfSample: boolean };
  failures: { symbol: string; message: string }[]; notes: string[];
}
export interface HorizonSummary {
  timeframe: Timeframe; trades: number; winRate: number | null; profitFactor: number | null; expectancyR: number | null;
  ciLowR: number | null; ciHighR: number | null; drawdownR95: number | null;
  exitReasons: { stopped: number; trail: number; target: number; time: number };
  histogram: { low: number | null; high: number | null; count: number }[];
  validated: boolean;
}
