import type { Candle, Timeframe } from "../types";

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com"];
export const INTERVAL_MS: Record<Timeframe, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const CACHE_MS = 60_000;
const REQUEST_BUDGET_MS = 25_000;
const PACE_MS = 120;
const cache = new Map<string, { data: unknown; receivedAt: number }>();
const pending = new Map<string, Promise<{ data: unknown; receivedAt: number }>>();
const waiters: (() => void)[] = [];
let active = 0;
let nextStartAt = 0;
let blockedUntil = 0;
let preferredHost = 0;
let pacing: Promise<void> = Promise.resolve();

export class MarketDataError extends Error {
  constructor(message: string, public readonly category: "invalid" | "network" | "rate-limit" | "restricted" | "stale" = "invalid") {
    super(message);
    this.name = "MarketDataError";
  }
}

export function publicError(error: unknown): string {
  return error instanceof MarketDataError ? error.message : "Market data could not be processed safely";
}

export function marketSource(): string {
  return `Binance public spot market data · ${new URL(HOSTS[preferredHost]).hostname}`;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function limited<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
  try {
    const precedingStart = pacing;
    let releaseStart!: () => void;
    pacing = new Promise<void>((resolve) => { releaseStart = resolve; });
    await precedingStart;
    try {
      // Serialize actual starts. Reserving future times can bunch requests after an event-loop delay.
      while (true) {
        const start = Math.max(Date.now(), nextStartAt, blockedUntil);
        if (start >= deadline) throw new MarketDataError(blockedUntil > Date.now() ? "Exchange rate-limit cooldown is active; retry later" : "Public data request exceeded its time budget", blockedUntil > Date.now() ? "rate-limit" : "network");
        if (start <= Date.now()) break;
        await pause(start - Date.now());
      }
      nextStartAt = Date.now() + PACE_MS;
    } finally { releaseStart(); }
    return await operation();
  } finally {
    const next = waiters.shift();
    if (next) next(); // Transfer this slot rather than temporarily freeing it.
    else active--;
  }
}

function retryDelay(response: Response): number {
  const header = response.headers.get("Retry-After");
  if (!header) return response.status === 418 ? 120_000 : 60_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 60_000;
}

async function fetchPublic(path: string): Promise<{ data: unknown; receivedAt: number }> {
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  let host = preferredHost;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    let data: unknown;
    try {
      const fetched = await limited(async () => {
        const response = await fetch(`${HOSTS[host]}${path}`, {
          method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(Math.max(1, Math.min(8_000, deadline - Date.now()))), cache: "no-store",
        });
        // Keep the slot until the body is consumed; fetch() alone resolves at the headers.
        if (response.ok) {
          try { return { response, data: await response.json() as unknown }; }
          catch { throw new MarketDataError("Binance returned an invalid JSON data response", "invalid"); }
        }
        await response.body?.cancel();
        return { response, data: undefined };
      }, deadline);
      response = fetched.response;
      data = fetched.data;
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      if (attempt === 2 || Date.now() >= deadline) throw new MarketDataError("Public Binance endpoints are unreachable or timed out", "network");
      host = (host + 1) % HOSTS.length;
      continue;
    }
    if (response.status === 429 || response.status === 418 || response.status === 403) {
      const delay = retryDelay(response);
      blockedUntil = Math.max(blockedUntil, Date.now() + delay);
      // A ban or long cooldown fails promptly; no host switching can circumvent the IP limit.
      if (response.status === 429 && delay <= 2_000 && attempt < 2 && blockedUntil < deadline) continue;
      throw new MarketDataError(`Exchange rate-limit cooldown is active (${Math.ceil(delay / 1_000)} seconds); retry later`, "rate-limit");
    }
    if (response.status === 451 || response.status >= 500) {
      if (attempt < 2) { host = (host + 1) % HOSTS.length; continue; }
      throw new MarketDataError(response.status === 451 ? "Binance public data is unavailable in this hosting region" : "Binance public data service is temporarily unavailable", response.status === 451 ? "restricted" : "network");
    }
    if (!response.ok) throw new MarketDataError(`Binance rejected the public data request (HTTP ${response.status})`, "invalid");
    preferredHost = host;
    return { data, receivedAt: Date.now() };
  }
  throw new MarketDataError("Public Binance data is unavailable", "network");
}

async function request(path: string, parameters: Record<string, string | number> = {}, cacheMs = CACHE_MS): Promise<{ data: unknown; receivedAt: number }> {
  const query = new URLSearchParams(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value)]));
  const key = `/api/v3/${path}${query.size ? `?${query}` : ""}`;
  const existing = cache.get(key);
  if (existing && Date.now() - existing.receivedAt < cacheMs) return existing;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const result = fetchPublic(key).then((entry) => {
    for (const [cachedKey, value] of cache) if (Date.now() - value.receivedAt >= CACHE_MS) cache.delete(cachedKey);
    cache.set(key, entry);
    return entry;
  }).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MarketDataError("Invalid public market data object");
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return NaN;
  return Number(value);
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,30}$/.test(normalized)) throw new MarketDataError("Invalid market symbol");
  return normalized;
}

/** Cached exchange time advances from its receipt time, independent of the machine clock offset. */
export async function getExchangeTime(): Promise<number> {
  const entry = await request("time");
  const serverTime = number(object(entry.data).serverTime);
  if (!Number.isSafeInteger(serverTime) || serverTime < 0) throw new MarketDataError("Invalid Binance exchange timestamp");
  return serverTime + Math.max(0, Date.now() - entry.receivedAt);
}

export function validateCandles(candles: Candle[], interval: Timeframe): void {
  const duration = INTERVAL_MS[interval];
  if (!duration) throw new MarketDataError("Unsupported candle timeframe");
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume, candle.quoteVolume, candle.takerBuyVolume];
    if (values.some((value) => !Number.isFinite(value)) || candle.open <= 0 || candle.low <= 0 || candle.close <= 0
      || candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close)
      || candle.volume < 0 || candle.quoteVolume < 0 || candle.takerBuyVolume < 0 || candle.takerBuyVolume > candle.volume + Math.max(1e-9, candle.volume * 1e-9)) {
      throw new MarketDataError("Invalid OHLC or volume values in exchange candles");
    }
    if (!Number.isSafeInteger(candle.time) || candle.time < 0 || candle.time % duration !== 0 || candle.closeTime !== candle.time + duration - 1) {
      throw new MarketDataError("Invalid candle timestamps or interval duration");
    }
    if (index > 0 && candle.time - candles[index - 1].time !== duration) throw new MarketDataError("Candle time continuity failed: missing, duplicate or unordered bars");
  }
}

export async function getCandles(symbol: string, interval: Timeframe, limit = 260, startTime?: number): Promise<Candle[]> {
  const normalized = normalizeSymbol(symbol);
  if (!(interval in INTERVAL_MS) || !Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new MarketDataError("Invalid candle timeframe or limit (1–1000)");
  if (startTime !== undefined && (!Number.isSafeInteger(startTime) || startTime < 0)) throw new MarketDataError("Invalid candle start time");
  const parameters: Record<string, string | number> = { symbol: normalized, interval, limit };
  if (startTime !== undefined) parameters.startTime = startTime;
  const [candlesResult, timeResult] = await Promise.allSettled([request("klines", parameters), getExchangeTime()]);
  if (candlesResult.status === "rejected") throw candlesResult.reason;
  if (timeResult.status === "rejected") throw timeResult.reason;
  const entry = candlesResult.value;
  const exchangeTime = timeResult.value;
  if (!Array.isArray(entry.data)) throw new MarketDataError("Invalid Binance candle data response");
  const candles = entry.data.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 11) throw new MarketDataError("Invalid Binance candle row");
    return { time: number(row[0]), open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]), closeTime: number(row[6]), quoteVolume: number(row[7]), takerBuyVolume: number(row[9]) };
  });
  validateCandles(candles, interval);
  return candles.filter((candle) => candle.closeTime < exchangeTime);
}

export async function getOrderBook(symbol: string): Promise<{ bids: [number, number][]; asks: [number, number][]; asOf: string }> {
  const entry = await request("depth", { symbol: normalizeSymbol(symbol), limit: 50 });
  const exchangeTime = await getExchangeTime();
  const data = object(entry.data);
  const parse = (value: unknown): [number, number][] => {
    if (!Array.isArray(value)) throw new MarketDataError("Invalid order-book response");
    return value.map((row: unknown) => {
      if (!Array.isArray(row)) throw new MarketDataError("Invalid order-book level");
      const price = number(row[0]); const quantity = number(row[1]);
      if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) throw new MarketDataError("Invalid order-book price or quantity");
      return [price, quantity];
    });
  };
  const bids = parse(data.bids); const asks = parse(data.asks);
  if (!bids.length || !asks.length || bids[0][0] >= asks[0][0]
    || bids.some((bid, index) => index > 0 && bid[0] >= bids[index - 1][0])
    || asks.some((ask, index) => index > 0 && ask[0] <= asks[index - 1][0])) throw new MarketDataError("Empty, crossed or unordered public order book");
  return { bids, asks, asOf: new Date(exchangeTime - Math.max(0, Date.now() - entry.receivedAt)).toISOString() };
}

export interface ExchangeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  spotAllowed: boolean;
  tickSize: number;
  stepSize: number;
  minNotional: number;
}

export interface Ticker24h { symbol: string; price: number; change24h: number; quoteVolume24h: number }

/** One bounded public batch. Cached observations retain their original receipt timestamp. */
export async function getSpotPrices(symbols: string[]): Promise<{ symbol: string; price: number; asOf: string }[]> {
  if (!Array.isArray(symbols) || symbols.length > 50) throw new MarketDataError("Spot quote batches must contain at most 50 symbols");
  if (!symbols.length) return [];
  const normalized = [...new Set(symbols.map((symbol) => {
    if (typeof symbol !== "string") throw new MarketDataError("Invalid spot quote symbol");
    return normalizeSymbol(symbol);
  }))].sort();
  const entry = await request("ticker/price", { symbols: JSON.stringify(normalized) }, 15_000);
  if (!Array.isArray(entry.data)) throw new MarketDataError("Invalid spot quote response");
  const prices = new Map<string, number>();
  for (const raw of entry.data) {
    const row = object(raw);
    const price = number(row.price);
    if (typeof row.symbol !== "string" || !normalized.includes(row.symbol) || prices.has(row.symbol)) throw new MarketDataError("Unexpected or duplicate spot quote symbol");
    if (!Number.isFinite(price) || price <= 0) throw new MarketDataError("Invalid public spot quote price");
    prices.set(row.symbol, price);
  }
  if (prices.size !== normalized.length) throw new MarketDataError("Missing requested spot quote symbols");
  const asOf = new Date(entry.receivedAt).toISOString();
  return normalized.map((symbol) => ({ symbol, price: prices.get(symbol)!, asOf }));
}

/** A single exchangeInfo GET supplies the tradable universe and all price/lot filters. */
export async function getExchangeSymbols(): Promise<ExchangeSymbol[]> {
  const data = object((await request("exchangeInfo")).data);
  if (!Array.isArray(data.symbols)) throw new MarketDataError("Invalid exchange symbol information");
  const symbols: ExchangeSymbol[] = [];
  for (const raw of data.symbols) {
    const row = object(raw);
    if (typeof row.symbol !== "string" || typeof row.baseAsset !== "string" || typeof row.quoteAsset !== "string" || typeof row.status !== "string" || !Array.isArray(row.filters)) continue;
    const filters = row.filters.map(object);
    const price = filters.find((filter) => filter.filterType === "PRICE_FILTER");
    const lot = filters.find((filter) => filter.filterType === "LOT_SIZE");
    const notional = filters.find((filter) => filter.filterType === "NOTIONAL") ?? filters.find((filter) => filter.filterType === "MIN_NOTIONAL");
    const tickSize = number(price?.tickSize); const stepSize = number(lot?.stepSize); const minNotional = number(notional?.minNotional);
    if (![tickSize, stepSize, minNotional].every(Number.isFinite) || tickSize <= 0 || stepSize <= 0 || minNotional < 0) continue;
    const permissions = Array.isArray(row.permissions) && row.permissions.includes("SPOT");
    const permissionSets = Array.isArray(row.permissionSets) && row.permissionSets.some((set) => Array.isArray(set) && set.includes("SPOT"));
    symbols.push({ symbol: row.symbol, baseAsset: row.baseAsset, quoteAsset: row.quoteAsset, status: row.status, spotAllowed: row.isSpotTradingAllowed === true || (row.isSpotTradingAllowed !== false && (permissions || permissionSets)), tickSize, stepSize, minNotional });
  }
  return symbols;
}

/** A single all-symbol ticker GET avoids repeated high-weight per-symbol metadata calls. */
export async function get24hTickers(): Promise<Ticker24h[]> {
  const { data } = await request("ticker/24hr");
  if (!Array.isArray(data)) throw new MarketDataError("Invalid 24-hour market ticker response");
  const tickers: Ticker24h[] = [];
  for (const raw of data) {
    const row = object(raw);
    const price = number(row.lastPrice); const change24h = number(row.priceChangePercent); const quoteVolume24h = number(row.quoteVolume);
    if (typeof row.symbol === "string" && [price, change24h, quoteVolume24h].every(Number.isFinite) && price > 0 && quoteVolume24h >= 0) {
      tickers.push({ symbol: row.symbol, price, change24h, quoteVolume24h });
    }
  }
  return tickers;
}
