# Operations and recovery

## Publication sequence

The scheduled publisher uses the source code from the default branch and the previous state from `market-data`. Runtime data is never added to `main`. The Actions job has bounded step/job timeouts, `contents: write` only for that publisher job, and the shared concurrency group `market-data-publisher`. A manual dispatch and scheduled dispatch cannot publish concurrently through that workflow.

The local commands are `node scripts/data-branch.mjs restore`, `npm run scan -- --publish`, and `node scripts/data-branch.mjs publish`. Restoring saves the exact remote base in ignored `data/.branch-base.json`. Publication fetches the remote tip again, refuses a changed base, builds a tree with a temporary Git index, and pushes normally. First publication creates an orphan data branch; later commits retain that branch's parent. Unrecognized existing branch files are preserved. Only explicitly allowed public runtime files are added; `.env` files, keys, full candles and local briefs cannot be swept into the branch.

Archives must be plain files and append-only. Restoration merges unique local archive records after the remote bytes, preserving unpublished local records where possible. An id collision with different content stops the operation. Missing local archive files remain in the remote tree. Source HEAD, working files and the source index are not switched or reset.

The scanner validates `SCAN_SYMBOLS` as one to fifty unique USDT symbols. An explicit fifty-symbol watchlist is not silently capped at the automatic default of fifty. Automatic universes require twenty to fifty eligible liquid markets. Binance requests use a bounded public-data queue, cache, retries and exchange rate-limit cooldown; falling back to another host never bypasses throttling.

## Timing and simulation

Binance candle open/close timestamps and structure confirmation timestamps are Unix milliseconds. ISO strings describe publication and report times. Convert to seconds only at the chart library boundary.

`snapshot.generatedAt` records the scan's timestamp. A new original's `publishedAt` is captured from exchange time **after** existing-outcome evaluation, immediately before local publication. These are separate timestamps. A scan beginning just before an hourly boundary cannot backdate a signal into a bar that was underway when processing finished. For example, a scan starting at `09:59:55` and publishing at `10:00:20` first becomes eligible for the full bar starting at `11:00:00`. Data-branch push and CDN visibility add delivery latency; recorded hourly fills are conservative research approximations, never verified exchange executions.

For each active original, download closed execution bars (15m for 15M, 1h for other horizons) beginning one execution interval after its last evaluated open, or at the first full execution open at/after publication. The existing tracking engine preserves original levels and checks continuity before advancing. A failed or missing series leaves the original active and reports an evaluation diagnostic. The per-run evaluation budget is bounded; deferred originals remain available for a later catch-up run.

BUY originals alone can enter a simulated position. A WAIT original is conditional research and can expire, invalidate, or be superseded by a separately published BUY in the same asset and timeframe. A later BUY never edits the WAIT original or awards a historical fill. Separate 15M/1H/4H/1D originals use their own causal score, selected-horizon ATR/structure and plan. Publication flattens all available `snapshot.timeframes` while preserving `snapshot.setups` as the hourly compatibility view; legacy originals without `timeframe` mean 1H.

15M uses 15-minute outcome candles; other horizons use hourly outcome candles. Unfilled expiry / open holding limits are 6/18 hours for 15M, 24/72 hours for 1H, 72/216 hours for 4H, and 168/720 hours for 1D. The full position exits at TP3, stop or that original's completed-candle holding rule; intermediate targets are milestones. Terminal invalidations cannot later be overwritten by expiry fallback. The four analysis datasets are fetched once per asset and reused across horizons.

Fresh lifecycle ids are deduplicated into the compact alert list. Conditional publication itself does not create a trade-entry alert. Original and final-outcome archives are written before state compaction. `state.json` retains every active original and the latest one thousand completed originals; monthly archives preserve the longer history.

## Outages and failure behavior

On complete market-data failure the CLI exits nonzero, saves an unavailable diagnostic state, and retains the previous valid setup prices and `dataAsOf` when available. These held values are stale research, not fresh recommendations. It does not publish new originals from an unavailable scan. Partial market/history failures remain explicit errors while valid markets can still be shown.

The workflow publishes a present diagnostic state even when the scan step failed, then marks the run failed. A hard runner cancellation or timeout can still prevent final persistence. Check the Actions run and the public state's timestamps; do not infer health merely from the existence of JSON. State and report files are replaced atomically, while archive ids prevent duplicate original/outcome records after ordinary retries.

If the helper reports that the remote branch advanced, run restore and the scanner again before retrying publication. Do not force-push an old local state. If an archive collision is reported, preserve both local and remote files and inspect the conflicting id before repair; deleting old lines discards audit history. Back up or clone the data branch independently before administrative repair. Do not reset the source checkout to the data branch.

## Daily analytics

The same daily due decision also runs `scripts/validate-scanner.ts --days 90` for the production scanner on BTC/ETH/SOL and all four horizons. Its compact validated `scanner-validation.json` is preserved on the dedicated branch and attached to state; raw historical candles remain ignored. A failed refresh preserves the prior valid report and timestamp. Failed symbols are listed in a partial report. Inspect report age and Actions logs; a stale report is never evidence that a fresh validation succeeded. Manual `analytics=true` dispatch forces an explicit retry of both reports.

The publisher checks UTC calendar days using both the report generation time and `analytics-attempt.json`. It marks an attempt before installing optional adapters or downloading data, so an ordinary failed daily attempt is not repeated on every hourly scan. Manual dispatch's analytics checkbox forces an explicit retry. A manual core-only run remains available:

```powershell
python -m analytics.run --symbol BTCUSDT --limit 1000 --output data/analytics.json --no-optional
```

Daily optional installation uses pinned `requirements-analytics.txt` and cached wheels. Installation failure is nonfatal; the analytical core and optional-absence diagnostics still work. The Python CLI preserves the previous output if a fresh report fails. The scanner attaches a valid `data/analytics.json` to state, otherwise retaining the previous report. Report age remains visible.

The report's chronological EMA/RSI strategies are separate from the multi-timeframe recommendation score. No future-fitted segmentation is used as a trading input. `ruptures` output is retrospective; River ADWIN is chronological drift observation. The [audit](open-source-audit.md) documents the installed licenses, deferred SMC/MarketProfile integrations, test conventions and known sample limitations. CI runs Node 24 verification and the Python test suite under Python 3.12, including pinned optional adapters.

## Optional alerts and commentary

`ALERT_WEBHOOK_URL` is a GitHub Actions secret for a generic HTTPS endpoint accepting `{ "version": 1, "events": [...] }`. Each event includes a deterministic id. The request also includes an idempotency key. Up to fifty pending/fresh events are sent in a bounded batch; failed deliveries stay queued for a later scan, while successful ids are retained in `alert-delivery.json`. Enabling a webhook does not replay the entire historical archive.

The receiver should deduplicate **event ids**, not only the batch key. A crash after the receiver accepts a request but before acknowledgement reaches durable Git state can still cause redelivery; there is no distributed exactly-once guarantee. Invalid configuration or a corrupt delivery ledger is reported without failing the market scan. URLs and keys are not logged or stored in public state. Browser notifications are a separate local feature requiring permission and an open terminal/refresh.

Grok commentary is manual CLI only and requires explicit `XAI_API_KEY` plus `XAI_MODEL`. It uses at most three fresh, qualified, high-score BUY plans and one bounded request. Numeric data comes solely from a copied frozen payload. Strict output validation rejects numeric or guaranteed prose and invented plan ids; failure preserves the previous brief and never changes state. Do not place these credentials in `NEXT_PUBLIC_*`, Git, public workflow input text, browser storage or the Vercel deployment.

## Hosting and retention

Vercel's public terminal reads `https://raw.githubusercontent.com/<owner>/<repo>/market-data/state.json`. Configure `MARKET_DATA_REPOSITORY` and the project region `sin1`. The repository/data branch must be publicly readable for this default deployment. No user PAT or writable GitHub credential belongs on Vercel. The browser Scan API is a preview; trusted GitHub Actions owns official publication.

Monthly original/outcome archives have no automatic deletion policy. Workflow diagnostic artifacts expire after fourteen days. The helper refuses individual managed files exceeding fifty MiB rather than silently truncating them; monitor growth and plan an audited archival migration if the workload outgrows JSON/Git. Back up local paper exports independently. Scheduling, regional access, CDN caching, exchange candle revisions and fixed OHLC/cost assumptions remain operational/research limits, not guarantees of production reliability.
