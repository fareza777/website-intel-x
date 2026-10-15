import type { Timeframe } from "../types";
export interface ReplayTrade { id: string; publishedAt: string; enteredAt: string; exitAt: string; entryFill: number; exitFill: number; quantity: number; pnl: number; returnPct: number; status: string }
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
  rows: ScannerValidationRow[]; failures: { symbol: string; message: string }[]; notes: string[];
}
