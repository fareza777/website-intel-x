# Chart Studio, 15M research and strategy evidence

## Reading the terminal

The contextual **Panduan halaman** button opens Indonesian explanations for the current page. **Panduan terminal** also includes Chart Studio, the precise strategy rules, a glossary, and primary source links. Chart settings change the chart only; they do not rewrite frozen research or change the scanner rules.

Chart Studio supports candlesticks, line and area, price/log/percentage axes, grid and magnet crosshair, resizable synchronized volume/RSI/MACD/ATR panes, EMA/SMA/Bollinger/session VWAP/prior Donchian overlays, original entry/stop/targets and confirmed structure markers. Presets and validated period settings are saved locally. Invalid stored settings fall back to defaults. Chart data refreshes right after each candle closes while visible, with an explicit last closed-candle timestamp and a retained-history warning after failed refreshes.

Hover, tap, or previous/next candle controls show exact OHLC/base volume and three distinct measurements:

- Candle body: `(close / open - 1) × 100%`.
- Candle range: `(high - low) / open × 100%`.
- Change from previous close: `(close / previousClose - 1) × 100%`; unavailable on the first bar.

Bollinger uses population standard deviation. Session VWAP uses reported quote/base volume and resets at UTC midnight. Donchian excludes the current candle. EMA/RSI/MACD/ATR use the production causal indicator functions. Chart history normally contains 499 closed candles from a 500-kline request. Research normally uses 259 closed candles from a 260-kline request. Different windows, parameters and reference times can produce different indicator values; the chart does not imply that research repaints.

Native [Lightweight Charts percentage mode](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/PriceScaleMode) references the first visible value, which becomes 0%; panning and zooming can change that reference. It is not the selected candle's body percentage. Price/log modes are appropriate for comparing absolute price levels and overlays.

## Four independent research horizons

`cx-spot-4` keeps the four independent horizons introduced in v3 and revises qualification as documented in [the v4 audit](qualification-v4-audit-2026-10-16.md). 15M scores and decisions use their own closed 15-minute candle and 1H/4H confirmation, with all context cut off at the decision close. A failed 15M download does not suppress otherwise valid 1H/4H/1D research. All feeds are downloaded once per asset and reused.

| Horizon | Confirmation context | Unfilled expiry | Maximum holding | Execution bars |
| --- | --- | --- | --- | --- |
| 15M | 1H and 4H | 6 hours | 18 hours | 15 minutes |
| 1H | 4H and 1D | 24 hours | 72 hours | 1 hour |
| 4H | 1D | 72 hours | 216 hours | 1 hour |
| 1D | Daily context | 168 hours | 720 hours | 1 hour |

Recommendation publication remains **hourly at minute 17**, as requested. A 15-minute candle interval does not mean scans every 15 minutes. A new local 15M simulation requires a decision no older than 30 minutes; otherwise scan again. Already reserved plans retain their original expiry and levels. Missing execution candles pause outcomes instead of skipping unknown price paths.

## Method and professional references

The strategy combines EMA trend agreement, RSI, MACD, UTC VWAP, relative volume, actual taker-buy share and confirmed price structure. The guide lists every gate and the score allocation. ATR and confirmed support determine the stop; target levels and position sizing include both-side costs, tick/lot rounding and capital constraints.

Minimum costed position loss remains 0.25%; maximum ATR / position-stop loss is 4%/8% for 15M, 6%/10% for 1H, 10%/20% for 4H and 12%/25% for 1D. These are fixed application tolerances, not universally validated trading thresholds. A specific breakout/reclaim or EMA21 pullback and decision uptrend are required; MACD, preferred RSI, VWAP and taker-buy are supporting quality measurements rather than separate vetoes. A loss of 8% on a position is different from risking 8% of an account. The account budget determines quantity; the explanation panel shows both quantities and diagnostic candidate levels for a rejected stop.

Primary references inspected:

- [Freqtrade Strategies](https://github.com/freqtrade/freqtrade-strategies): GPL-3.0 reference only; no strategy source copied or dependency added. Its examples do not establish profitability on this universe.
- [Freqtrade look-ahead analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/): methodology reference for causal validation, not a claim that Freqtrade's checker was run against this custom engine.
- [QuantConnect LEAN](https://github.com/QuantConnect/Lean) and its [Donchian indicator documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/indicators/supported-indicators/donchian-channel): Apache-2.0 reference for conventional indicators; no trading service integration.
- [CME position sizing](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size): logical stop placement and account-risk budgeting are separate inputs to sizing.

Using standard indicators or consulting a repository does **not** validate this particular combination of thresholds. The terminal labels it a research strategy, preserves rejections, and never presents a setup score as an actual win probability.

## Replay of the production scanner

`npx tsx scripts/validate-scanner.ts --days 90` downloads real Binance candles for a predeclared BTC/ETH/SOL/INJ universe, then reuses `analyzeSymbol`, `publishSignals`, `advanceSignal`, `reservePosition` and `applyPaperUpdates`. There is no substitute backtest rule set or parameter optimization. Each pair/horizon uses an independent 10,000 USDT account with a risk budget of 1% of initial capital. Results cannot be summed into the return of a shared portfolio.

Scans assume hourly publication at :17. Each frame has 259 closed bars and its own decision-time context cutoff. Historical rolling ticker values are approximated from 24 contiguous closed hourly candles. Current exchange lot/tick/minimum filters and the present-day universe introduce historical-filter and selection limitations. Real GitHub publication can occur later; this replay is not a reproduction of actual publication latency or trade-level exchange fills.

Old signals advance before a new scan; publication, WAIT supersession, deduplication, full future execution bars, stop gaps, expiry and holding limits follow production rules. An entry bar cannot earn a target. Known opening events precede ambiguous intrabar extremes. TP1/2 are milestones without partial cash proceeds. Pending reservations remain part of equity and are refunded when unfilled orders terminate. Open positions are marked with their latest closed **execution** feed (15M or 1H), after estimated exit costs, never with a stale higher-horizon decision close.

Profit factor uses net realized currency P/L; expectancy uses mean net completed-trade percentage. Undefined statistics are null. Returns include mark-to-market open exposure; win rate counts completed trades only. Drawdown uses hourly scan marks, so it does not measure the worst unobserved intrabar move. Daily sampled curves are compact display data. Accounts continue across three descriptive chronological windows; these thirds are not untouched out-of-sample validation.

Fewer than 30 completed trades triggers a sample warning, not a significance test. The matched v3/v4 90-day audit observed more qualified trades but mixed, mostly unfavorable intraday results and a small daily sample. It does not establish a profitable edge; see the dated v4 audit for actual counts and returns. Strategy Lab displays this report separately from the Python baseline walk-forward comparison and the forward public Signal Autopsy ledger.

The daily workflow refreshes the replay, validates the compact report and attaches it to published state. Missing/corrupt replacement files preserve prior valid evidence and its timestamp. Failed symbols are explicit, not treated as zero-return successful tests. Raw historical candles stay in memory during the replay; only the compact report and normal state reach `market-data`.
