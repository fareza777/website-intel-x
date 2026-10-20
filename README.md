# CryptoScanora

Advanced crypto trading intelligence built with Next.js, TypeScript, Python and real Binance spot data. The terminal publishes deterministic research plans and tracks simulated outcomes without placing real orders.

Live application: [cryptoscanora.top](https://cryptoscanora.top/) (Vercel fallback: [cryptointel-x-nu.vercel.app](https://cryptointel-x-nu.vercel.app/)). [Verification workflow](https://github.com/fareza777/website-intel-x/actions/workflows/ci.yml) and [scheduled market publisher](https://github.com/fareza777/website-intel-x/actions/workflows/market-data.yml).

The production domain is connected to the `cryptointel-x` Vercel project. Spaceship DNS uses the Vercel-provided apex A records and the project-specific `www` CNAME; keep unrelated records such as MX/TXT entries intact. `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx`, the web manifest, canonical metadata and JSON-LD are generated for `https://cryptoscanora.top`. To enable Google Search Console ownership, place the verification token returned by Google in `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` for Vercel Production, redeploy, then submit `https://cryptoscanora.top/sitemap.xml`.

The 15M, 1H, 4H, and 1D horizon selector changes the actual recommendation and setup score. Equal scores can still occur when the independently measured conditions agree. Recommendation publication remains hourly; new 15M paper entries require a decision within 30 minutes. Chart Studio provides configurable indicators, synchronized panes, candle percentages, presets and saved settings. Use **Measure** to drag between two price levels or select two points and read the percentage change, price difference and time span. The terminal and contextual guides default to English. See [chart and strategy evidence](docs/chart-and-strategy-evidence.md) and the [terminal integrity audit](docs/terminal-integrity-audit-2026-10-16.md).

## Current qualification · cx-spot-6

BUY requires the safety checks, a valid decision uptrend, a confirmed breakout/structure reclaim or EMA21 pullback recovery, a market that is not risk-off (bearish BTC higher-timeframe trend with fewer than 30% of scanned markets above EMA50), and a positive calibrated edge from a model that passed its out-of-sample holdout. **No edge, no trade:** horizons whose model failed validation stay research-only. With the bundled `cx-model-f2-730d-2026-07-19` (two years, futures positioning, gradient boosting), only 1D is validated; 15M, 1H and 4H publish WAIT research. See the [cx-spot-6 audit](docs/engine-v6-2026-10-17.md) and the earlier [cx-spot-5 audit](docs/engine-v5-2026-10-17.md) for the honest out-of-sample numbers.

- **Calibrated edge.** `scripts/train-model.ts` labels every long-entry candidate with the production fill/exit engine, fits L2 logistic and gradient-boosted models over twenty-seven causal features (trend, slope, ADX, ATR percentile, squeeze, distance to the 20-bar high, hour-of-day volume z-score, taker-buy, relative strength and beta versus BTC, BTC trend, breadth, trigger type, stop risk, swing structure, VWAP) and chooses each horizon's exit profile and minimum edge on a purged chronological holdout. Training ends where the scanner replay starts, so the published replay is out-of-sample for the bundled `lib/market/model.json`. A model that fails the holdout (AUC ≥0.55, positive 90% bootstrap lower bound on selected trades, better than all candidates) is shown only as information.
- **Futures positioning.** Open-interest change, retail and top-trader long/short ratios, taker buy/sell ratio and the premium index (the driver of funding) come from Binance's public USDⓈ-M archives on `data.binance.vision`. The live futures API is geo-restricted for the publisher's runners, so every decision uses only archives published at least 36 hours earlier. Training, replay and live scans share this lag.
- **Learners.** Logistic regression and gradient-boosted trees (`lib/market/boosting.ts`, no external dependency) compete on the purged holdout; the winner per horizon is refitted on the full training window. The browser loads only a weight-free model summary.
- **Momentum Rotation.** A separate portfolio strategy ranks the universe by risk-adjusted momentum (positive momentum above SMA50, inverse-volatility weights) and holds the leaders while BTC closes above its 100-day average, otherwise cash. Lookback and holdings are chosen on the training window; the replay reports its out-of-sample backtest against BTC buy-and-hold.
- **Managed exits.** New plans sell half at TP1, move the remainder to a costed breakeven and trail it by a frozen ATR multiple until TP3, the trail or the holding limit. Stops win ambiguous bars. Legacy plans keep the full-position TP3 rule.
- **Sizing.** The chosen account risk is reduced for top-quintile ATR, BTC beta ≥1.5 and 15M; active simulations may risk at most 6% of initial capital together.

The [Research model workflow](.github/workflows/research.yml) trains the model and replays the engine out-of-sample beside the main-branch baseline. See [the cx-spot-5 audit](docs/engine-v5-2026-10-17.md).

## Local virtual portfolio

Take a qualified BUY from the trade workspace to reserve virtual cash against the exact displayed plan. The saved recommendation keeps its original timeframe, score, levels, costs, expiry and holding period. Each asset/horizon can have one active local simulation; different horizons are independent and share the same finite cash balance. WAIT research never becomes an executed trade without a new qualified BUY.

The portfolio saves in the browser's IndexedDB, with a small localStorage fallback, and supports validated JSON export/import. Its balance ledger is checked on import. Real Binance quote marks refresh every 30 seconds while open; stale/missing quotes show unavailable P/L. Closed 15-minute candles for 15M research and hourly candles for other horizons reconcile entries, TP/SL and time exits every 5 minutes while open. Manual cancellation and virtual exits first reconcile completed candles; manual exits require a fresh Binance quote and include exit costs. The realized balance curve contains only your own completed virtual trades.

Records and journals remain on this device and origin. They are not uploaded to the public signal branch. Browser storage can be cleared, so export backups when needed. Closed-candle OHLC cannot prove exact tick fills or intrabar order; conservative stop-first resolution and no same-entry-bar target credit are explicit model assumptions.

A spot research terminal built with Next.js, TypeScript and TradingView Lightweight Charts. It scans real Binance public data, explains deterministic technical rules, records immutable research plans, and simulates later outcomes. No trading account, exchange key or LLM is required. It never places orders.

## Run locally

Use Node.js 24 and Python 3.12. The package supports Node 22 or later; CI exercises Node 24. Python's standard library runs the mandatory analytical core.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run scan -- --publish
npm run dev
```

Open the address printed by Next.js, normally `http://localhost:3000`. The explicit local `--publish` command seeds ignored `data/state.json` and its local recommendation ledger from real data. During development, the server selects the newer trusted publication from this local state and the shared GitHub data branch. A failed download produces an unavailable state; no sample market data is substituted.

Next.js reads `.env.local` automatically. Standalone CLI commands read the process environment; to load that file explicitly, use `node --env-file=.env.local --import tsx scripts/scan.ts --publish`. Copying the example does not configure any secrets.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
python -m unittest discover -s tests/python -v
python -m analytics.run --symbol BTCUSDT --limit 1000 --output data/analytics.json --no-optional
```

Install `requirements-analytics.txt` only when the optional research adapters are wanted. The [open-source audit](docs/open-source-audit.md) records versions, licenses, causality findings, actual integration and verification limits.

## Preview versus publication

The browser's Scan button and `npm run scan` create previews. CLI previews go to ignored `data/preview.json`; they do not create official historical recommendations. `npm run scan -- --publish` updates the local immutable ledger. It becomes the shared official ledger only when a trusted publisher saves that state to the dedicated `market-data` branch.

The scheduled [publisher workflow](.github/workflows/market-data.yml) runs at minute seventeen every UTC hour and also supports manual dispatch. GitHub runner start times can be delayed. It restores the previous public data branch, optionally refreshes daily analytics, advances existing originals using subsequent closed hourly candles, publishes new qualified BUY and conditional WAIT research, then saves the result back to the data branch. WAIT originals never enter a simulated position; a later qualified BUY is a separate original. The publisher serializes runs with `cancel-in-progress: false` and uses the workflow's limited `GITHUB_TOKEN`, not a personal access token.

For an explicit manual remote publication from an authenticated local clone:

```powershell
node scripts/data-branch.mjs restore
npm run scan -- --publish
node scripts/data-branch.mjs publish
```

These commands write runtime files only under ignored `data/`. The helper builds a separate Git tree through a temporary index and leaves the source checkout, HEAD and index untouched. It creates an orphan data history on the first publication and uses normal fast-forward pushes thereafter. It refuses concurrent remote changes or archive rewrites; it never force-pushes. Keep source code on `main` and runtime state on `market-data`.

Set `SCAN_SYMBOLS` to a comma/space-separated list of one to fifty USDT markets, or leave it empty for the fifty eligible markets with the highest average daily USDT volume over the last seven days (Binance's rolling `windowSize=7d` ticker, falling back to 24h volume if unavailable), so a one-day spike cannot buy a place. `SCAN_LIMIT` optionally changes the automatic universe to twenty through fifty, or intentionally caps an explicit watchlist. Stablecoins, known tokenized securities and leveraged tokens are excluded. A new listing without enough closed history remains an explicit partial-scan error.

## What the numbers mean

- Market cards, radar prices and the workspace price use a separate Binance full rolling 24-hour ticker checked every **30 seconds** while visible. Price, 24-hour change and USDT quote volume use the same live observation, with its exchange timestamp. Missing or old observations show unavailable values. Closed charts refresh right after each candle of the selected interval closes (retrying briefly until the exchange publishes it); the CDN caches identical chart history until that close. The published research state refreshes every 5 minutes; the signal ledger and strategy reports load only on their pages. The research reference price is the **last closed candle's close at the recommendation scan**, identified by `asOf`. Setup scores and technical inputs remain tied to that frozen scan; plans and archived outcomes are never rewritten by quote updates.
- The 15M, 1H, 4H and 1D views have separate recommendation scores, causal structure, volume windows, ATR stops and target plans. They reuse the same four downloaded datasets, rather than multiplying exchange requests. SMA-seeded EMA, Wilder RSI/ATR and MACD remain causal; pivots require right-side confirmation. A score measures rule agreement, **not win probability**.
- Markets sort by BUY, WAIT, then NO TRADE before technical quality. Each new setup publishes its safety and entry checklist, including the actual cost-adjusted stop risk when a plan is rejected. High technical scores cannot override a failed risk, liquidity, trend or volatility check. Missing or more than two-hour-old scan timestamps are stale under the hourly schedule.
- Costs default to **ten basis points fee and five basis points adverse slippage on each side**. Targets and sizing include both entry and exit costs, capital limits, lot steps and minimum notional. These are research assumptions, not a complete exchange order validator.
- Session VWAP uses reported quote/base totals. Candle-distributed profiles and POC approximate traded volume at price. Order blocks, FVGs and sweeps are price-action heuristics, not proof of institutional activity.
- Published levels stay fixed. 15M evaluates fills using subsequent full 15-minute bars; other horizons use subsequent full hourly bars; the candle already underway at publication is ignored. For an already-open position, known opening stop/target events are resolved before subsequent intrabar events; favorable target gaps fill at the fixed target, and adverse stop gaps include the worse opening price. Stops win otherwise ambiguous stop/target bars, and a new limit fill receives no same-bar target credit. cx-spot-5 plans sell half at TP1, then protect the remainder at a costed breakeven and an ATR trail until TP3, the trail or the holding limit; legacy plans treat TP1/TP2 as milestones and fully exit at TP3, stop or the holding limit. Unfilled originals expire at their fixed expiry after sufficient candle coverage. Missing history pauses evaluation and blocks manual cancellation/exit until every eligible completed execution bar is reconciled.

| Research horizon | Unfilled expiry | Maximum open holding period |
| --- | --- | --- |
| 15M | 6 hours | 18 hours |
| 1H | 24 hours | 72 hours |
| 4H | 72 hours | 216 hours |
| 1D | 168 hours | 720 hours |

Each asset/horizon retains its own original, so a daily position does not silently replace an hourly thesis. Older state without a timeframe continues to mean 1H; `snapshot.setups` remains the 1H compatibility view.

Higher-timeframe changes require reassessment and affect qualification of new research; they do not move an original's levels or automatically exit an existing simulation. See [operations and recovery](docs/operations.md) for the lifecycle, publication timing and outage behavior.

The [2026-10-15 accuracy audit](docs/accuracy-audit-2026-10-15.md) documents real-market qualification counts, independent indicator comparisons, regression coverage and the limits of the performance evidence.

## Production scanner replay

Run `npx tsx scripts/validate-scanner.ts --days 90` to replay the actual decision, publication, lifecycle and portfolio functions on a predeclared twelve-market history with shared BTC/breadth context. The daily publisher attaches this validated compact report to state. Strategy Lab displays pooled per-horizon expectancy in R with a 90% bootstrap interval, Monte Carlo drawdown, exit-reason and R-distribution charts, a market × horizon heatmap, the model's holdout calibration, and independent pair/horizon accounts with inspectable trades. This is retrospective research with limited evidence, not an assertion of proven profitability; the Python baseline comparison remains separate.

## Durable data and retention

The public data branch contains compact `state.json`, the latest `analytics.json` and `scanner-validation.json`, scan diagnostics, optional webhook delivery ids, and monthly JSONL archives. Every BUY/WAIT original is archived once with its original setup. Every final outcome is archived once. State keeps all active originals plus the latest one thousand completed records; monthly archives are retained without automatic expiry. No full candle downloads or binary databases are committed. Diagnostic workflow artifacts expire after fourteen days and are separate from durable archives.

The daily Python analytical report compares two fixed chronological long-spot rules on real historical data. It is **not a measured backtest of the terminal's full scoring engine**. Optional packages add descriptive diagnostics and independent comparisons without changing the core trade series. Short samples, no-trade folds, negative results and unavailable optional diagnostics are reported honestly.

## Deployment and optional integrations

Deploy the source branch to Vercel with the configured Singapore region, `sin1`, and set `MARKET_DATA_REPOSITORY` to the public owner/repository that holds `market-data`. Public hosting reads published JSON; it does not rely on durable Vercel filesystem writes. Do not put a GitHub PAT, trading keys, webhook URL or model key in public client variables. The default terminal needs no paid API route.

GitHub Actions variables may set `SCAN_SYMBOLS` and `SCAN_LIMIT`. An optional Actions secret, `ALERT_WEBHOOK_URL`, enables generic HTTPS JSON alert batches. Successful event ids are recorded; failed deliveries remain pending. The receiver must deduplicate each event id to handle the unavoidable crash window between remote acceptance and durable acknowledgement. No webhook is contacted when this secret is absent.

An optional manual Grok brief needs explicit `XAI_API_KEY` and `XAI_MODEL` environment values:

```powershell
node --env-file=.env.local --import tsx scripts/brief.ts --input data/state.json --output data/brief.json
```

It makes at most one paid request for at most three fresh BUY plans scoring at least eighty. All supplied prices, targets, stops and scores are copied from deterministic frozen data. Returned prose must be qualitative: digits, number words, numeric claims, invented ids, extra numeric fields and guaranteed outcomes are rejected. The file is local commentary and is not used to modify the ledger. No paid model is selected by default or invoked by the scanner or public routes.

## Current limits

GitHub scheduling and public CDN reads are best effort; they can be delayed or unavailable. Binance access depends on the hosting region and exchange limits. The scanner fails closed for unavailable, incomplete, stale or discontinuous data. Classification exclusions need maintenance as Binance adds assets. JSON state suits a modest research workload; archive size and repository growth need monitoring.

The browser paper portfolio and journal live in IndexedDB, with a localStorage fallback; preferences and alert read-state use localStorage on that browser/profile. Export them for backup. Browser alerts need permission and an open terminal or refresh; they are not guaranteed background push notifications. Shared automated outcomes belong to the published global ledger, separately from local paper positions. Neither OHLC simulation nor fixed slippage proves an executable live fill or future profitability.

TradingView Lightweight Charts is Apache-2.0; retain its license/NOTICE and visible attribution. Python optional components use MIT, BSD-2-Clause, BSD-3-Clause and Apache-2.0 licenses as detailed in the audit. `smartmoneyconcepts` and `MarketProfile` were audited and deferred, not silently integrated. Software licensing and Binance data rights are separate; the audit records the current dataset terms and their commercial-use limits.
