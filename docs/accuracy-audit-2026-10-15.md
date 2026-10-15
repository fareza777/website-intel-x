# Recommendation and simulation audit — 2026-10-15

The scanner did not return only NO TRADE. The public snapshot generated at 16:05:25.001 UTC analyzed 29 of 30 liquid spot markets:

| Horizon | BUY | WAIT | NO TRADE |
| --- | ---: | ---: | ---: |
| 1H | 0 | 10 | 19 |
| 4H | 0 | 2 | 27 |
| 1D | 0 | 0 | 29 |

A later real-data preview during browser verification returned 0/9/20 for 1H and unchanged 4H/1D counts. These are observations at those scans, not permanent counts. HYPE was explicitly unavailable for insufficient EMA200 context history. No substitute series was used.

After deploying the repairs, the publisher generated a new snapshot at **17:03:41.236 UTC**, using the newly closed **16:59:59.999 UTC** hourly candle. Results were 1H **0 BUY / 0 WAIT / 29 NO TRADE**, 4H **0 / 2 / 27**, and 1D **0 / 0 / 29**. BTC 1H fell to score 41, below the unchanged WAIT minimum 50. PYTH 1H scored 93 but required 15.14% stop risk. ZK's stop risk was now 9.02%, still above 8%. All 87 horizon setups carried their qualification checklist. This change between scans demonstrates why an earlier WAIT count must not be treated as current evidence.

## Why high scores were rejected

The old interface sorted by technical score alone, placing rejected markets ahead of conditional candidates. ZK 1H scored 82, but its required structure/ATR stop implied 10.11% cost-adjusted loss in the observed preview, above the unchanged 8% maximum. STRK 4H scored 92 in the audited public snapshot, but failed volatility and risk-plan checks. Score measures technical agreement and cannot override safety conditions.

Markets now sort by BUY, WAIT, then NO TRADE, with technical score within each group. The interface shows per-horizon counts, the principal rejection reason and all thirteen qualification checks. The scoring formula, BUY gates and risk limits remain unchanged. An independent differential review compared 12,000 risk inputs and 1,080 setup analyses with the prior implementation without a change to numerical plans, scores, actions, indicators, volume calculations, identifiers or expiry. The risk helper now exposes rejection diagnostics.

BUY is reachable in every horizon under the existing rules. Regression tests use controlled causal candle fixtures, including consistent hourly-to-higher-frame aggregation reviewed separately, to verify this. Those fixtures are test-only; they were never published as market signals or inserted into a browser portfolio. This verifies reachable behavior, not market profitability or frequency.

## Independent indicator comparison

Real Binance BTCUSDT, ETHUSDT and ZKUSDT data were retrieved at **2026-10-15T16:27:29.534Z**. All three decision horizons and their three causal context frames were compared with native `pandas-ta-classic` 0.8.32 calculations (`talib=False`, SMA-seeded EMA). Eight outputs per context produced **216 comparisons**.

| Indicator | Maximum absolute difference |
| --- | ---: |
| EMA21 | 2.91e-11 |
| EMA50 | 7.28e-11 |
| EMA200 | 2.33e-10 |
| RSI14 | 2.13e-14 |
| ATR14 | 5.78e-7 |
| MACD | 5.82e-11 |
| MACD signal | 3.51e-11 |
| MACD histogram | 2.31e-11 |

Every comparison passed `max(1e-5, abs(reference) * 1e-5)`. The small finite-window ATR difference is within this tolerance. The reference is an independent calculation check; it does not replace scanner inputs. Raw downloads and comparison scratch files remain under ignored `data/`, not source control. Reference behavior: [pandas-ta-classic indicators](https://xgboosted.github.io/pandas-ta-classic/indicators.html). Data source: [Binance public market-data endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md).

## Confirmed defects repaired

- **Opening target before a later stop:** an already-open position with O=121, H=125, L=94, C=99, SL=95 and TP3=120 previously recorded a stop. The known opening target now resolves first at the conservative fixed target price, including costs. TS tracking and Python baselines both have regressions. Opening TP1/TP2 milestones also survive a later stop. Otherwise ambiguous intrabar stop/target bars remain stop-first; entry bars receive no target credit.
- **Manual virtual management across missing hours:** an empty or gapped successful HTTP response could allow cancellation/refund or manual exit before unknown completed hours were evaluated. Coverage is now required both by the UI and the cash-ledger settlement function. Recovered history permits management again; a genuinely new plan with no eligible completed hour is allowed. Fresh quote requirements for manual exits still apply.
- **Hourly freshness:** the UI retained a five-hour threshold after switching the workflow to hourly scans. A snapshot now becomes stale after two scheduled intervals; invalid or materially future timestamps also fail closed.
- **Local manual scan:** Next.js reconstructed a `localhost` request URL while the browser used `127.0.0.1`, incorrectly returning 403 for same-origin scans. The check now validates the Origin against the actual HTTP Host, ignores forwarded-host spoofing and still rejects foreign/malformed origins. The endpoint is a public read-only market preview, not an authenticated trading action.

Additional clarity fixes distinguish historical baseline strategies from the scanner, show horizon/action in original-signal history, label the session VWAP calculation correctly, and report an unexecuted optional drift detector as unavailable rather than a negative finding.

## Verification and evidence limits

- 135 TypeScript tests across 16 files passed.
- All 34 Python tests passed in the isolated environment with optional adapters installed.
- ESLint, TypeScript checking and the production Next.js build passed.
- Browser verification used real local requests: manual scan succeeded; ZK rejection detail and its 10/13 checklist matched the calculated risk; WAIT filtering returned nine hourly candidates, two four-hour candidates and an empty daily view; paper and public ledgers displayed their real empty/pending state.

The strategy lab evaluates two fixed historical baselines, not a backtest of the full scanner. Original scanner recommendations are measured separately through Signal Autopsy. At this audit the public ledger had no completed qualified BUY simulations, so there is no observed scanner win rate or profit evidence to report. The local virtual portfolio was not populated with fake trades. OHLC simulation cannot prove tick-level execution or future returns. Optional paid Grok and external webhook delivery require configured credentials/destinations; validation is tested, but no external messages or paid model calls were sent for this audit.

The hourly publisher remains scheduled at minute 17 UTC. A successful manual workflow run verifies the publication path; GitHub scheduling and CDN propagation can delay when a scheduled result becomes visible. Real-time quote refresh and closed-candle polling remain separate from frozen recommendation plans.

Delivery checks: [CI run 38773965855](https://github.com/fareza777/website-intel-x/actions/runs/38773965855) and [publisher run 38773985698](https://github.com/fareza777/website-intel-x/actions/runs/38773985698) succeeded for code commit `a7655b4`. Vercel reported the production deployment READY in `sin1`. Production quotes, candles and depth returned HTTP 200. The refreshed baseline report was generated at 17:03:32.851 UTC with data through 16:59:59.999 UTC. All thirteen previously published original setup objects were compared with the prior data-branch revision and remained unchanged; only subsequent evaluation state may advance.
