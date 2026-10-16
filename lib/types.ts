export type Timeframe = "15m" | "1h" | "4h" | "1d";
export type ContextTimeframe = Exclude<Timeframe, "15m">;
export type Action = "BUY" | "WAIT" | "NO TRADE";
export type Regime = "BULLISH" | "BEARISH" | "SIDEWAYS" | "HIGH VOLATILITY";
export interface SpotQuote { symbol: string; price: number; asOf: string }
export interface Candle {
  /** Binance candle opening time: Unix milliseconds. Convert to seconds only for charts. */
  time: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  takerBuyVolume: number;
}
export interface IndicatorSet {
  ema21: number; ema50: number; ema200: number; rsi: number;
  macd: number; macdSignal: number; macdHistogram: number;
  atr: number; trend: "bullish" | "bearish" | "neutral";
}
export interface StructureEvent {
  type: "BOS" | "CHoCH" | "SWEEP" | "FVG" | "ORDER BLOCK" | "FALSE BREAKOUT";
  direction: "bullish" | "bearish";
  price: number;
  /** Confirmation candle close time, in Unix milliseconds; never the earlier pivot time. */
  time: number;
  description: string;
}
export interface TradePlan {
  entry: number;
  entryZone: [number, number];
  stopLoss: number;
  targets: { price: number; rr: number; gainPct: number }[];
  riskPct: number;
  feeBps: number;
  slippageBps: number;
  tickSize: number;
  stepSize: number;
  minNotional: number;
}
export interface VolumeIntelligence {
  vwap: number; poc: number; relativeVolume: number; buyPressure: number;
  profile: { price: number; volume: number }[];
}
export interface MarketSetup {
  /** Frozen rule version, entry trigger and horizon-specific policy; absent on legacy originals. */
  strategyVersion?: string;
  entryModel?: "BREAKOUT" | "STRUCTURE_RECLAIM" | "PULLBACK";
  policy?: { maximumAtrPct: number; maximumStopRiskPct: number; minimumBuyScore: number };
  /** Diagnostic candidate levels, also retained when the trade plan is rejected. */
  riskReview?: { entry: number; stopLoss: number; costedLossPct: number; maximumLossPct: number; feeBps: number; slippageBps: number };
  /** Observed rule checks, frozen with the research; older originals may omit them. */
  qualification?: QualificationCheck[];
  /** Exchange tick size is retained even when no executable trade plan qualifies. */
  tickSize?: number;
  /** The decision horizon; legacy records without this field are 1H research. */
  timeframe?: Timeframe;
  /** Maximum simulated holding duration after entry, fixed when the plan is published. */
  holdingPeriodHours?: number;
  id: string;
  symbol: string;
  baseAsset: string;
  name: string;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  score: number;
  action: Action;
  regime: Regime;
  asOf: string;
  expiresAt: string;
  plan: TradePlan | null;
  indicators: Record<ContextTimeframe, IndicatorSet> & Partial<Record<"15m", IndicatorSet>>;
  reasons: string[];
  confirmations: string[];
  invalidations: string[];
  structure: StructureEvent[];
  volume: VolumeIntelligence;
  sparkline: number[];
}
export interface QualificationCheck {
  id: string;
  label: string;
  requiredFor: "plan" | "buy" | "context";
  passed: boolean;
  detail: string;
}
export interface MarketSnapshot {
  version: 1;
  generatedAt: string;
  dataAsOf: string | null;
  status: "live" | "partial" | "unavailable";
  source: string;
  universeSize: number;
  scanned: number;
  errors: { symbol: string; message: string }[];
  setups: MarketSetup[];
  /** Independently calculated research at each horizon. No other horizon is a fallback. */
  timeframes?: Record<ContextTimeframe, MarketSetup[]> & Partial<Record<"15m", MarketSetup[]>>;
  durationMs: number;
  costs: { feeBps: number; slippageBps: number };
}
export type SignalStatus = "PENDING" | "OPEN" | "TP1" | "TP2" | "TP3" | "STOPPED" | "EXPIRED" | "INVALIDATED" | "CLOSED";
export interface SignalEvent {
  id: string; signalId: string; type: string; at: string; price: number | null; detail: string;
}
export interface TrackedSignal {
  setup: MarketSetup;
  publishedAt: string;
  status: SignalStatus;
  enteredAt: string | null;
  entryFill: number | null;
  exitAt: string | null;
  exitFill: number | null;
  lastEvaluatedTime: number;
  highestTarget: number;
  realizedReturnPct: number | null;
  events: SignalEvent[];
}
export interface StoredState {
  version: 1;
  updatedAt: string;
  snapshot: MarketSnapshot | null;
  signals: TrackedSignal[];
  alerts: SignalEvent[];
  analytics: AnalyticsReport | null;
  scannerValidation?: import("./research/types").ScannerValidationReport | null;
}
export interface AnalyticsReport {
  generatedAt: string;
  symbol: string;
  dataSource: string;
  start: string;
  end: string;
  strategies: { name: string; trades: number; winRate: number | null; profitFactor: number | null; expectancy: number | null; maxDrawdown: number; totalReturn: number; trainReturn: number; testReturn: number; overfitWarning: boolean; equity: { time: string; value: number }[] }[];
  notes: string[];
  regime: { current: string; changePoints: string[]; driftDetected: boolean; method: string };
}
