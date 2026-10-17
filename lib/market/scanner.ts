import type { Candle, MarketSetup, MarketSnapshot, Timeframe } from "../types";
import { breadthOf, type MarketContext } from "./context";
import { DEFAULT_ROTATION, rotationSignal, type RotationSignal } from "./rotation";
import { BUNDLED_MODEL } from "./bundled-model";
import { archiveFetcher, fetchDerivativeDays, requiredDays, type ArchiveFetcher, type DerivativeDay } from "./derivatives";
import { get24hTickers, get7dQuoteVolumes, getCandles, getExchangeSymbols, getExchangeTime, MarketDataError, marketSource, publicError } from "./binance";
import { DEFAULT_COSTS } from "./risk";
import { analyzeSymbol, MIN_QUOTE_VOLUME } from "./setup";
import { compareOpportunities } from "../opportunities";

// This asset classification list must be reviewed when Binance introduces new stablecoins.
// United Stables (U): https://www.binance.com/en/support/announcement/detail/54de0a1147d04cf382707002a30901fd
const STABLE_ASSETS = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "USDD", "USD1", "USDE", "U", "EUR", "EURI", "EURC", "AEUR", "PAX", "GUSD", "UST", "USTC", "PYUSD", "RLUSD", "BFUSD", "USDS", "USDG", "VAI", "SUSD", "FRAX", "LUSD"]);
// bStocks have no documented asset-class field in exchangeInfo. Exclude the known tokenized
// securities (including leveraged ETFs) instead of treating every ticker ending in B as a stock.
// Sources: Binance announcements 2026-08-28, 2026-09-02 and 2026-10-07.
// https://www.binance.com/en/square/post/360412003002911
// https://www.binance.com/en-AE/support/announcement/detail/b3ba5cf68daf4264a1260c8da11eef6d
// https://www.binance.com/en/support/announcement/detail/a1a7996170f246da90ea49f199a61bcd
const TOKENIZED_SECURITIES = new Set([
  "AAOIB", "AAPLB", "ALABB", "AMATB", "AMDB", "AMZNB", "ARMB", "ASMLB", "ASTSB", "AVGOB", "AXTIB", "BABAB", "BEB", "BMNRB", "CBRSB", "COHRB", "COINB", "CRCLB", "CRDOB", "CRWVB",
  "DELLB", "DJTB", "DRAMB", "EWYB", "FLNCB", "GLWB", "GMEB", "GOOGLB", "GSB", "HOODB", "IBMB", "INTCB", "INTWB", "IRENB", "KORUB", "LITEB", "METAB", "MRVLB", "MSFTB", "MSTRB",
  "MUB", "MUUB", "MVLLB", "NBISB", "NFLXB", "NOKB", "NVDAB", "ORCLB", "PLTRB", "PYPLB", "QCOMB", "QNTB", "QQQB", "QQQQB", "RKLBB", "SKHYB", "SMCIB", "SMHB", "SNDKB", "SNXXB",
  "SOXLB", "SOXSB", "SPCXB", "SPYB", "TQQQB", "TSLAB", "TSMB", "USARB", "WDCB", "CRWDB", "MRNAB", "SQQQB", "STXB", "CRMB", "HIMSB", "BNCB", "JPMB", "LLYB", "SECZB", "USDEB",
]);

/** Futures archive download for the whole universe, bounded so a slow archive host never blocks research. */
async function loadDerivatives(symbols: string[], now: number, fetcher: ArchiveFetcher): Promise<Record<string, DerivativeDay[]>> {
  const [first, last] = requiredDays(now);
  const result: Record<string, DerivativeDay[]> = {};
  const deadline = Date.now() + 40_000;
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < symbols.length && Date.now() < deadline) {
      const symbol = symbols[cursor++];
      try { result[symbol] = await fetchDerivativeDays(symbol, first, last, { fetcher, concurrency: 4 }); } catch { /* Missing positioning data stays null. */ }
    }
  }));
  return result;
}

/**
 * Rank the automatic universe by average daily USDT volume over the last 7 days, so a one-day spike
 * cannot push a market into the top list. Falls back to 24h volume if the weekly ticker is unavailable.
 */
async function rankUniverse<T extends { symbol: string; quoteVolume24h: number }>(markets: T[], limit: number): Promise<{ ranked: T[]; ranking: "7d-average" | "24h" }> {
  let weekly: Map<string, number> | null = null;
  try { weekly = await get7dQuoteVolumes(markets.map(market => market.symbol)); } catch { weekly = null; }
  if (weekly && weekly.size === 0) weekly = null;
  const daily = (market: T) => weekly ? (weekly.get(market.symbol) ?? 0) / 7 : market.quoteVolume24h;
  const ranked = markets.filter(market => daily(market) >= MIN_QUOTE_VOLUME)
    .sort((a, b) => daily(b) - daily(a) || a.symbol.localeCompare(b.symbol)).slice(0, limit);
  return { ranked, ranking: weekly ? "7d-average" : "24h" };
}

export async function scanMarket(options: { symbols?: string[]; limit?: number; derivatives?: ArchiveFetcher | null } = {}): Promise<MarketSnapshot> {
  const startedAt = Date.now();
  const errors: MarketSnapshot["errors"] = [];
  let universeSize = 0;
  let now = startedAt;
  let rotation: RotationSignal | undefined;
  let universeRanking: "7d-average" | "24h" = "24h";
  const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
  const timeframes: Record<Timeframe, MarketSetup[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  const snapshot = (): MarketSnapshot => {
    for (const timeframe of frames) timeframes[timeframe].sort(compareOpportunities);
    const setups = timeframes["1h"];
    const available = Object.values(timeframes).flat();
    return { version: 1, generatedAt: new Date(now).toISOString(),
      dataAsOf: available.length ? (setups.length ? setups : available).map((setup) => setup.asOf).sort()[0] : null,
      status: !available.length ? "unavailable" : errors.length ? "partial" : "live", source: marketSource(), universeSize, scanned: setups.length,
      errors, setups, timeframes, durationMs: Date.now() - startedAt, costs: { ...DEFAULT_COSTS }, universeRanking: options.symbols ? "watchlist" : universeRanking, ...(rotation ? { rotation } : {}) };
  };
  try {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < (options.symbols ? 1 : 20) || limit > 50) throw new MarketDataError(options.symbols ? "Watchlist limit must be an integer from 1 to 50" : "Automatic universe limit must be an integer from 20 to 50");
    const requested = options.symbols ? [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()))] : null;
    if (requested && (requested.length < 1 || requested.length > 50 || requested.some((symbol) => !/^[A-Z0-9]{1,26}USDT$/.test(symbol)))) throw new MarketDataError("Explicit watchlists must contain 1–50 valid USDT symbols");
    const [exchangeResult, tickerResult, timeResult] = await Promise.allSettled([getExchangeSymbols(), get24hTickers(), getExchangeTime()]);
    if (exchangeResult.status === "rejected") throw exchangeResult.reason;
    if (tickerResult.status === "rejected") throw tickerResult.reason;
    if (timeResult.status === "rejected") throw timeResult.reason;
    const exchangeSymbols = exchangeResult.value;
    const tickers = tickerResult.value;
    now = timeResult.value;
    const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
    // Symbols outside the ASCII pattern (e.g. Binance's non-Latin listings) cannot be requested or validated downstream.
    const tradable = exchangeSymbols.filter((symbol) => symbol.status === "TRADING" && symbol.spotAllowed && symbol.quoteAsset === "USDT" && /^[A-Z0-9]{1,26}USDT$/.test(symbol.symbol)
      && !STABLE_ASSETS.has(symbol.baseAsset) && !TOKENIZED_SECURITIES.has(symbol.baseAsset) && !/^[A-Z0-9]{2,}(UP|DOWN|BULL|BEAR)$/.test(symbol.baseAsset));
    const symbolMap = new Map(tradable.map((symbol) => [symbol.symbol, symbol]));
    const universe = requested
      ? requested.slice(0, options.limit ?? 50).flatMap((symbol) => {
        const info = symbolMap.get(symbol); const ticker = tickerMap.get(symbol);
        if (!info || !ticker) { errors.push({ symbol, message: "Symbol is not an eligible trading USDT spot market with valid ticker/filter data" }); return []; }
        return [{ ...info, ...ticker }];
      })
      : await rankUniverse(tradable.flatMap((symbol) => {
        const ticker = tickerMap.get(symbol.symbol);
        // A loose 24h pre-filter keeps the 7-day request small; the ranking itself uses the weekly average.
        return ticker && ticker.quoteVolume24h >= MIN_QUOTE_VOLUME / 5 ? [{ ...symbol, ...ticker }] : [];
      }), limit).then(({ ranked, ranking }) => { universeRanking = ranking; return ranked; });
    universeSize = requested ? Math.min(requested.length, options.limit ?? 50) : universe.length;
    if (!requested && universe.length < 20) throw new MarketDataError("Fewer than 20 liquid, eligible USDT spot markets are available; automatic scan withheld");
    type Fetched = { market: (typeof universe)[number]; candles: Record<Timeframe, Candle[]>; fetchErrors: string[] };
    const fetched = (await Promise.all(universe.map(async (market): Promise<Fetched | null> => {
      try {
        const candleResults = await Promise.allSettled(frames.map(frame => getCandles(market.symbol, frame)));
        const fetchErrors = candleResults.flatMap((result, index) =>
          result.status === "rejected" ? [`${frames[index].toUpperCase()} data: ${publicError(result.reason)}`] : []);
        // A missing 15M feed does not suppress valid hourly and longer research.
        if (candleResults.slice(1).some(result => result.status === "rejected")) throw new MarketDataError(fetchErrors.join("; "));
        return { market, fetchErrors, candles: Object.fromEntries(candleResults.map((result, i) => [frames[i], result.status === "fulfilled" ? result.value : []])) as Record<Timeframe, Candle[]> };
      } catch (error) {
        errors.push({ symbol: market.symbol, message: publicError(error) });
        return null;
      }
    }))).filter((item): item is Fetched => item !== null);
    // BTC defines market tone for every symbol, including watchlists that omit it.
    let btc = fetched.find(item => item.market.symbol === "BTCUSDT")?.candles;
    if (!btc) {
      const extra = await Promise.allSettled(frames.map(frame => getCandles("BTCUSDT", frame)));
      if (extra.every(result => result.status === "fulfilled")) btc = Object.fromEntries(extra.map((result, i) => [frames[i], (result as PromiseFulfilledResult<Candle[]>).value])) as Record<Timeframe, Candle[]>;
    }
    const closed = (candles: Candle[]) => candles.filter(candle => candle.closeTime < now);
    const derivatives = options.derivatives === null ? undefined : await loadDerivatives(fetched.map(item => item.market.symbol), now, options.derivatives ?? archiveFetcher);
    const context: MarketContext = {
      btc: btc ? Object.fromEntries(frames.map(frame => [frame, closed(btc![frame])])) : undefined,
      breadth: Object.fromEntries(frames.map(frame => [frame, breadthOf(fetched.map(item => closed(item.candles[frame])))]).filter(([, value]) => value !== null)),
      derivatives,
    };
    // Momentum Rotation ranks the same universe from its closed daily candles.
    const daily = Object.fromEntries(fetched.map(item => [item.market.symbol, closed(item.candles["1d"])]));
    if (btc && !daily.BTCUSDT) daily.BTCUSDT = closed(btc["1d"]);
    rotation = rotationSignal(daily, now, BUNDLED_MODEL.rotation?.params ?? DEFAULT_ROTATION);
    const results = fetched.map(({ market, candles, fetchErrors }) => {
      const analyzed: Partial<Record<Timeframe, MarketSetup>> = {};
      const failures: string[] = [...fetchErrors];
      for (const timeframe of frames) {
        if (!candles[timeframe].length) continue;
        try {
          const setup = analyzeSymbol({ ...market, now, candles }, timeframe, context);
          const stale = setup.reasons.find((reason) => reason.startsWith("Rejected stale"));
          if (stale) throw new MarketDataError(stale, "stale");
          analyzed[timeframe] = setup;
        } catch (error) { failures.push(`${timeframe.toUpperCase()}: ${publicError(error)}`); }
      }
      if (failures.length) errors.push({ symbol: market.symbol, message: failures.join("; ") });
      return analyzed;
    });
    errors.sort((a, b) => a.symbol.localeCompare(b.symbol));
    for (const result of results) for (const timeframe of frames) {
      const setup = result[timeframe];
      if (setup) timeframes[timeframe].push(setup);
    }
    return snapshot();
  } catch (error) {
    errors.push({ symbol: "MARKET", message: publicError(error) });
    return snapshot();
  }
}
