import { z } from "zod";
export const symbolSchema = z.string().regex(/^[A-Z0-9]{1,26}USDT$/);
export const watchlistSchema = z.array(symbolSchema).max(50);
export const seenAlertsSchema = z.array(z.string().max(250)).max(1000);
export const preferencesSchema = z.object({ capital: z.number().finite().min(100).max(1e9), risk: z.number().finite().min(.1).max(5), universe: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50)]), useWatchlist: z.boolean(), largeText: z.boolean() });
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const shortText = z.string().max(2000);
const texts = z.array(shortText).max(100);
export const planSchema = z.object({
  entry: positive, entryZone: z.tuple([positive, positive]), stopLoss: positive,
  targets: z.array(z.object({ price: positive, rr: positive, gainPct: positive })).length(3),
  riskPct: positive.max(100), feeBps: nonnegative.max(1000), slippageBps: nonnegative.max(1000),
  tickSize: positive, stepSize: positive, minNotional: nonnegative,
}).refine(p => p.stopLoss < p.entryZone[0] && p.entryZone[0] <= p.entry && p.entry <= p.entryZone[1] && p.targets[0].price > p.entry && p.targets[1].price > p.targets[0].price && p.targets[2].price > p.targets[1].price, "Invalid long research price ordering");
const indicators = z.object({ ema21: positive, ema50: positive, ema200: positive, rsi: nonnegative.max(100), macd: z.number().finite(), macdSignal: z.number().finite(), macdHistogram: z.number().finite(), atr: nonnegative, trend: z.enum(["bullish", "bearish", "neutral"]) });
export const setupSchema = z.object({
  qualification: z.array(z.object({ id: z.string().max(80), label: z.string().max(150), requiredFor: z.enum(["plan", "buy"]), passed: z.boolean(), detail: shortText })).max(30).optional(),
  tickSize: positive.optional(),
  timeframe: z.enum(["1h", "4h", "1d"]).optional(), holdingPeriodHours: z.number().int().min(1).max(720).optional(),
  id: z.string().min(1).max(200), symbol: symbolSchema, baseAsset: z.string().regex(/^[A-Z0-9]{1,26}$/), name: z.string().min(1).max(100),
  price: positive, change24h: z.number().finite(), quoteVolume24h: nonnegative, score: nonnegative.max(100), action: z.enum(["BUY", "WAIT", "NO TRADE"]), regime: z.enum(["BULLISH", "BEARISH", "SIDEWAYS", "HIGH VOLATILITY"]),
  asOf: z.iso.datetime(), expiresAt: z.iso.datetime(), plan: planSchema.nullable(),
  indicators: z.object({ "1h": indicators, "4h": indicators, "1d": indicators }),
  reasons: texts, confirmations: texts, invalidations: texts,
  structure: z.array(z.object({ type: z.enum(["BOS", "CHoCH", "SWEEP", "FVG", "ORDER BLOCK", "FALSE BREAKOUT"]), direction: z.enum(["bullish", "bearish"]), price: positive, time: positive, description: shortText })).max(100),
  volume: z.object({ vwap: positive, poc: positive, relativeVolume: nonnegative, buyPressure: nonnegative.max(1), profile: z.array(z.object({ price: positive, volume: nonnegative })).max(200) }),
  sparkline: z.array(positive).max(1000),
}).refine(s => s.symbol === `${s.baseAsset}USDT` && Date.parse(s.expiresAt) > Date.parse(s.asOf) && (s.action === "NO TRADE" || s.plan !== null), "Invalid asset identity or setup lifecycle");
export const eventSchema = z.object({ id: z.string().max(250), signalId: z.string().max(200), type: z.string().max(100), at: z.iso.datetime(), price: positive.nullable(), detail: shortText });
