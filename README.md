# CryptoIntel X

The 1H, 4H, and 1D horizon selector changes the actual recommendation and setup score. Equal scores can still occur when the independently measured conditions agree.

## Local virtual portfolio

Take a qualified BUY from the trade workspace to reserve virtual cash against the exact displayed plan. The saved recommendation keeps its original timeframe, score, levels, costs, expiry and holding period. Each asset/horizon can have one active local simulation; different horizons are independent and share the same finite cash balance. WAIT research never becomes an executed trade without a new qualified BUY.

The portfolio saves in the browser's IndexedDB, with a small localStorage fallback, and supports validated JSON export/import. Its balance ledger is checked on import. Real Binance quote marks refresh every 30 seconds while open; stale/missing quotes show unavailable P/L. Closed hourly candles reconcile entries, TP/SL and time exits every minute. Manual cancellation and virtual exits first reconcile completed candles; manual exits require a fresh Binance quote and include exit costs. The realized balance curve contains only your own completed virtual trades.

Records and journals remain on this device and origin. They are not uploaded to the public signal branch. Browser storage can be cleared, so export backups when needed. Closed-hourly OHLC cannot prove exact tick fills or intrabar order; conservative stop-first resolution and no same-entry-bar target credit are explicit model assumptions.

A spot research terminal built with Next.js, TypeScript and TradingView Lightweight Charts. It scans real Binance public data, explains deterministic technical rules, records immutable research plans, and simulates later outcomes. No trading account, exchange key or LLM is required. It never places orders.

## Run locally

Use Node.js 24 and Python 3.12. The package supports Node 22 or later; CI exercises Node 24. Python's standard library runs the mandatory analytical core.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run scan -- --publish
npm run dev
```

Open the address printed by Next.js, normally `http://localhost:3000`. The explicit local `--publish` command seeds ignored `data/state.json` and its local recommendation ledger from real data. The server reads this local state during development. A failed download produces an unavailable state; no sample market data is substituted.

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

The scheduled [publisher workflow](.github/workflows/market-data.yml) runs at minute seventeen every four UTC hours and also supports manual dispatch. It restores the previous public data branch, optionally refreshes daily analytics, advances existing originals using subsequent closed hourly candles, publishes new qualified BUY and conditional WAIT research, then saves the result back to the data branch. WAIT originals never enter a simulated position; a later qualified BUY is a separate original. The publisher serializes runs with `cancel-in-progress: false` and uses the workflow's limited `GITHUB_TOKEN`, not a personal access token.

For an explicit manual remote publication from an authenticated local clone:

```powershell
node scripts/data-branch.mjs restore
npm run scan -- --publish
node scripts/data-branch.mjs publish
```

These commands write runtime files only under ignored `data/`. The helper builds a separate Git tree through a temporary index and leaves the source checkout, HEAD and index untouched. It creates an orphan data history on the first publication and uses normal fast-forward pushes thereafter. It refuses concurrent remote changes or archive rewrites; it never force-pushes. Keep source code on `main` and runtime state on `market-data`.

Set `SCAN_SYMBOLS` to a comma/space-separated list of one to fifty USDT markets, or leave it empty for the thirty highest-volume eligible markets. `SCAN_LIMIT` optionally changes the automatic universe to twenty through fifty, or intentionally caps an explicit watchlist. Stablecoins, known tokenized securities and leveraged tokens are excluded. A new listing without enough closed history remains an explicit partial-scan error.

## What the numbers mean

- The displayed setup price is the **last closed candle's close for the selected horizon**, not a streaming quote. The default hourly view uses the last closed hourly price. `asOf` identifies that decision candle; the reported daily change and daily quote volume come from Binance's rolling ticker.
- The 1H, 4H and 1D views have separate recommendation scores, causal structure, volume windows, ATR stops and target plans. They reuse the same three downloaded datasets, rather than multiplying exchange requests. SMA-seeded EMA, Wilder RSI/ATR and MACD remain causal; pivots require right-side confirmation. A score measures rule agreement, **not win probability**.
- Costs default to **ten basis points fee and five basis points adverse slippage on each side**. Targets and sizing include both entry and exit costs, capital limits, lot steps and minimum notional. These are research assumptions, not a complete exchange order validator.
- Session VWAP uses reported quote/base totals. Candle-distributed profiles and POC approximate traded volume at price. Order blocks, FVGs and sweeps are price-action heuristics, not proof of institutional activity.
- Published levels stay fixed. All horizons evaluate fills using subsequent full hourly bars; the candle already underway at publication is ignored. Stops win ambiguous stop/target bars, adverse stop gaps are included, and a new limit fill receives no same-bar target credit. TP1/TP2 are milestones; the full exit is TP3, stop or the configured horizon's holding limit. Unfilled originals expire at their fixed expiry after sufficient candle coverage. Missing history pauses evaluation instead of inventing an outcome.

| Research horizon | Unfilled expiry | Maximum open holding period |
| --- | --- | --- |
| 1H | 24 hours | 72 hours |
| 4H | 72 hours | 216 hours |
| 1D | 168 hours | 720 hours |

Each asset/horizon retains its own original, so a daily position does not silently replace an hourly thesis. Older state without a timeframe continues to mean 1H; `snapshot.setups` remains the 1H compatibility view.

Higher-timeframe changes require reassessment and affect qualification of new research; they do not move an original's levels or automatically exit an existing simulation. See [operations and recovery](docs/operations.md) for the lifecycle, publication timing and outage behavior.

## Durable data and retention

The public data branch contains compact `state.json`, the latest `analytics.json`, scan diagnostics, optional webhook delivery ids, and monthly JSONL archives. Every BUY/WAIT original is archived once with its original setup. Every final outcome is archived once. State keeps all active originals plus the latest one thousand completed records; monthly archives are retained without automatic expiry. No full candle downloads or binary databases are committed. Diagnostic workflow artifacts expire after fourteen days and are separate from durable archives.

The daily analytical report compares two fixed chronological long-spot rules on real historical data. It is **not a measured backtest of the terminal's full scoring engine**. Optional packages add descriptive diagnostics and independent comparisons without changing the core trade series. Short samples, no-trade folds, negative results and unavailable optional diagnostics are reported honestly.

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
