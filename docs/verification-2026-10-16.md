# Chart Studio and 15M delivery verification · 2026-10-16

## Checks completed

- TypeScript: **158 tests across 20 files passed**. Coverage includes candle percentages, causal indicator prefixes, preferences validation, independent horizons, 15M publication/execution, missing execution bars, paper-account round-trip/freshness, exact costs, rejected risk explanations, replay chronology, expiry refunds, future append invariance, execution-feed equity marks, compact evidence validation and dedicated-branch persistence.
- Python: **34 tests passed**, including optional indicator/analytics checks.
- ESLint: no errors or warnings. `tsc --noEmit`: passed. Optimized Next.js build: passed.
- Both GitHub workflow YAML files parsed successfully; no duplicate step keys. `git diff --check` passed.
- Independent read-only review found two issues: stale higher-horizon portfolio marks and manual preview dropping published evidence. Both were corrected and tested. No remaining blocking finding was reported.

## Browser and API evidence

Desktop browser checks exercised real Binance chart data, actual canvas hover, previous/next candle navigation, a Momentum preset, EMA period edits, Bollinger, line style, logarithmic scale and persisted settings after reload. Defaults were restored after testing. Native percentage mode was checked against installed Lightweight Charts 5.2.1 source and official documentation: its zero reference is the first visible value, not the first loaded candle.

At a 390×844 viewport, mobile chart controls, OHLC, candle percentages and contextual guide remained legible. A horizontal overflow introduced by the extra horizon button was found and fixed. Normal content fits the available 375 CSS-pixel width excluding the scrollbar; expanded chart fits the viewport. The viewport override was reset after testing. Guide body text measured 17px; the mobile page title measured 33px.

The public site displayed all four research horizons and new Indonesian qualification explanations without a manual preview. The live published 15M scan contained 29 valid markets, seven WAIT candidates and 22 NO TRADE rejections. HYPEUSDT was explicitly unavailable because its required 4H EMA200 history was insufficient; it received no fabricated indicators. No BUY was forced.

Production API checks confirmed 499 closed BTCUSDT 15-minute candles, fresh BTC/ETH quotes and a timestamped real order book. Strategy Lab received 12 published pair/horizon replay rows. The chart's candle percent, research reference close, quote timestamp and recommendation scan timestamp remain separate concepts.

## Remote publication

Source feature commit: `70881a2c5bd7193edd6b5a55b96ca602cf4dbf8d`.

[GitHub verification](https://github.com/fareza777/website-intel-x/actions/runs/38825759581) and the [forced daily publisher](https://github.com/fareza777/website-intel-x/actions/runs/38825769499) both completed successfully. The publisher ran the Python comparison, production-scanner replay, four-horizon scan, immutable-original tracking and dedicated data-branch publication.

Data commit: `ad5063a8889f79aa295355a40077aae83e1f5115`. Published scan: `2026-10-15T23:49:40.491Z` (16 October, 06:49:40 WIB). Replay: `2026-10-15T23:49:18.937Z`, 12 rows, no failed symbols. The public `/api/market` returned this new state with `persistence: github` and all four timeframes after ordinary cache propagation.

Vercel feature deployment `dpl_HN2Mzft1nuYVGEcJAY8c8G5Tskep` reached READY in `sin1` for that exact source commit and assigned [cryptointel-x-nu.vercel.app](https://cryptointel-x-nu.vercel.app/). A following documentation/label correction clarifies percentage-axis semantics without changing research or replay calculations.

## Observed strategy evidence

The predeclared 90-day BTC/ETH/SOL replay produced **19 completed trades** across twelve independent 10,000 USDT accounts. It does not establish profitability. For 15M, BTC had five completed trades and −2.72% account return; ETH seven and −5.07%; SOL four and −0.32%. The remaining completed trades were two ETH 1H trades and one SOL 1H trade. Higher horizons had no completed trades; idle cash return is not evidence of safety or skill.

The report uses both-side 10-bps fees and 5-bps adverse slippage, 1% initial-capital risk sizing, current lot/tick/minimum filters, fixed levels and causal execution. Its three chronological windows are descriptive, not unseen out-of-sample validation. OHLC fill assumptions, ticker reconstruction, historical selection/filter limitations and hourly equity marks are disclosed. Setup scores remain uncalibrated rule-agreement ratings. The [method audit](chart-and-strategy-evidence.md) records primary references and calculation assumptions.
