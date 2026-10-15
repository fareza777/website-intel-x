import type { MarketSetup, MarketSnapshot, Timeframe } from "../types";
import { get24hTickers, getCandles, getExchangeSymbols, getExchangeTime, MarketDataError, marketSource, publicError } from "./binance";
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

export async function scanMarket(options: { symbols?: string[]; limit?: number } = {}): Promise<MarketSnapshot> {
  const startedAt = Date.now();
  const errors: MarketSnapshot["errors"] = [];
  let universeSize = 0;
  let now = startedAt;
  const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
  const timeframes: Record<Timeframe, MarketSetup[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  const snapshot = (): MarketSnapshot => {
    for (const timeframe of frames) timeframes[timeframe].sort(compareOpportunities);
    const setups = timeframes["1h"];
    const available = Object.values(timeframes).flat();
    return { version: 1, generatedAt: new Date(now).toISOString(),
      dataAsOf: available.length ? (setups.length ? setups : available).map((setup) => setup.asOf).sort()[0] : null,
      status: !available.length ? "unavailable" : errors.length ? "partial" : "live", source: marketSource(), universeSize, scanned: setups.length,
      errors, setups, timeframes, durationMs: Date.now() - startedAt, costs: { ...DEFAULT_COSTS } };
  };
  try {
    const limit = options.limit ?? 30;
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
    const tradable = exchangeSymbols.filter((symbol) => symbol.status === "TRADING" && symbol.spotAllowed && symbol.quoteAsset === "USDT"
      && !STABLE_ASSETS.has(symbol.baseAsset) && !TOKENIZED_SECURITIES.has(symbol.baseAsset) && !/^[A-Z0-9]{2,}(UP|DOWN|BULL|BEAR)$/.test(symbol.baseAsset));
    const symbolMap = new Map(tradable.map((symbol) => [symbol.symbol, symbol]));
    const universe = requested
      ? requested.slice(0, options.limit ?? 50).flatMap((symbol) => {
        const info = symbolMap.get(symbol); const ticker = tickerMap.get(symbol);
        if (!info || !ticker) { errors.push({ symbol, message: "Symbol is not an eligible trading USDT spot market with valid ticker/filter data" }); return []; }
        return [{ ...info, ...ticker }];
      })
      : tradable.flatMap((symbol) => {
        const ticker = tickerMap.get(symbol.symbol);
        return ticker && ticker.quoteVolume24h >= MIN_QUOTE_VOLUME ? [{ ...symbol, ...ticker }] : [];
      }).sort((a, b) => b.quoteVolume24h - a.quoteVolume24h || a.symbol.localeCompare(b.symbol)).slice(0, limit);
    universeSize = requested ? Math.min(requested.length, options.limit ?? 50) : universe.length;
    if (!requested && universe.length < 20) throw new MarketDataError("Fewer than 20 liquid, eligible USDT spot markets are available; automatic scan withheld");
    const results = await Promise.all(universe.map(async (market) => {
      const analyzed: Partial<Record<Timeframe, MarketSetup>> = {};
      try {
        const candleResults = await Promise.allSettled(frames.map(frame => getCandles(market.symbol, frame)));
        const fetchErrors = candleResults.flatMap((result, index) =>
          result.status === "rejected" ? [`${frames[index].toUpperCase()} data: ${publicError(result.reason)}`] : []);
        // A missing 15M feed does not suppress valid hourly and longer research.
        if (candleResults.slice(1).some(result => result.status === "rejected")) throw new MarketDataError(fetchErrors.join("; "));
        const candles = Object.fromEntries(candleResults.map((result, i) => [frames[i], result.status === "fulfilled" ? result.value : []])) as Record<Timeframe, import("../types").Candle[]>;
        const failures: string[] = [...fetchErrors];
        for (const timeframe of frames) {
          if (!candles[timeframe].length) continue;
          try {
            const setup = analyzeSymbol({ ...market, now, candles }, timeframe);
            const stale = setup.reasons.find((reason) => reason.startsWith("Rejected stale"));
            if (stale) throw new MarketDataError(stale, "stale");
            analyzed[timeframe] = setup;
          } catch (error) { failures.push(`${timeframe.toUpperCase()}: ${publicError(error)}`); }
        }
        if (failures.length) errors.push({ symbol: market.symbol, message: failures.join("; ") });
        return analyzed;
      } catch (error) {
        errors.push({ symbol: market.symbol, message: publicError(error) });
        return analyzed;
      }
    }));
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
