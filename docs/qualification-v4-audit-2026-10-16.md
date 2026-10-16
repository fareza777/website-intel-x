# Practical qualification audit · cx-spot-4 · 2026-10-16

## Reported problem and cause

The published 2026-10-16T01:23:50.268Z scan showed daily INJ quality **97/100**, but rejected it: daily ATR 9.29% exceeded a fixed 6% limit; the costed structural stop 19.87% exceeded 8%; and 24-day taker-buy 49.76% missed a separate 52% entry gate. The same percent caps had been used across 15M and 1D, and every supportive indicator was also compulsory. High agreement therefore rarely became an actionable entry.

The [frozen implementation plan](superpowers/plans/2026-10-16-realistic-qualification.md) specified the revised rules before running the new historical evaluation. There was no parameter optimizer or search for profitable settings.

## Current mandatory rules and supporting context

Data freshness, liquidity, absence of required bearish context, overextension, horizon volatility limits, a valid costed plan, decision close > EMA50 > EMA200, score >=78 and a specific closed price trigger remain mandatory.

Two entry paths are accepted:

1. A bullish prior-20-bar breakout, or a bullish structure reclaim confirmed on the decision candle, with relative volume >=1.0. The current high is excluded from the trailing breakout channel.
2. A controlled EMA21 touch/reclaim within the last three candles and a bullish decision close above EMA21 and the previous close. A pullback need not have elevated breakout volume, but the underlying 0.3x liquidity floor still applies.

MACD, preferred RSI 45–70, session VWAP and taker-buy participation contribute the existing weighted quality score. They are visible supporting checks, not four independent vetoes. RSI >78, price >3 ATR above EMA21, a missing price trigger or an invalid risk plan can still reject a high score. A score never represents a win probability.

| Horizon | Maximum ATR / price | Maximum costed position loss | BUY score floor |
| --- | --- | --- | --- |
| 15M | 4% | 8% | 78 |
| 1H | 6% | 10% | 78 |
| 4H | 10% | 20% | 78 |
| 1D | 12% | 25% | 78 |

These caps are application tolerances for different holding horizons, not universal professional standards or validated profit optima. Stops still use actual ATR/support; the engine does not move a stop closer merely to fit the limit. Wider swing stops reduce quantity. Fees, slippage, cash limits, lot steps and minimum notional remain enforced. The legacy risk function defaults to 8% for old callers; new setups carry an explicit frozen policy and rule version. Existing originals and portfolios are not rewritten.

## Real current scan

The 2026-10-16T04:33:37.786Z preview analyzed 29 real markets. Daily INJ **97** and PYTH **92** qualified through breakout; NEAR **87** and FIL **87** through EMA21 pullbacks; ZRO **83** through a confirmed structure reclaim. STRK remained NO TRADE with approximately 47.89% required stop loss and 15.56% ATR. Other horizons independently produced one 15M BUY, one 1H BUY and no 4H BUY at that scan; counts naturally change with data.

INJ retained its original 19.87% costed stop distance. At 10,000 USDT capital and 1% account risk, sizing keeps planned loss at approximately 100 USDT and allocates approximately 503 USDT before lot rounding. It does not risk 19.87% of the account. A BUY can be reserved immediately in paper trading; a simulated fill still requires a later eligible candle to reach the exact entry price.

## Matched real-data replay

The comparison used identical cached Binance BTC/ETH/SOL/INJ candles from **2026-07-18T05:17:00.000Z through 2026-10-16T04:17:00.000Z**. INJ was included because it was the reported case, not because of a favorable backtest. Each pair/horizon had its own 10,000 USDT account and 1% initial-capital risk budget. Both versions used the same production publication, OHLC fill, accounting, expiry and holding engines, with 10-bps fees and 5-bps slippage on each side.

The prior analyzer was preserved exactly from commit `2ee9eb243e31694172ba169e02d90c180a2f5711`, adjusting only local import paths. An independent reviewer verified that source match, identical dates/data, legacy risk default and current report code hash. Raw candles and temporary comparison code remain ignored. Only compact current evidence is published through the normal data branch.

| Pair | v3 completed trades, all horizons | v4 completed trades, all horizons | v4 1D completed trades | v4 1D marked account return |
| --- | --- | --- | --- | --- |
| BTC | 5 | 65 | 1 | +1.47% |
| ETH | 9 | 79 | 1 | +0.08% |
| SOL | 5 | 58 | 1 | +1.23% |
| INJ | 3 | 55 | 4 | +0.66% |

Total completed trades increased from **22 to 257**, across sixteen independent accounts. This demonstrates less restrictive qualification, not improved profitability. Intraday outcomes were mostly unfavorable: BTC 15M −9.86%, ETH 15M −16.28%, SOL 15M +1.50%, INJ 15M −1.00%. All daily samples remain too small to establish robustness, and BTC/INJ daily marked returns include open exposure. Account returns cannot be added into a shared-portfolio return.

The current report contains all sixteen rows, losses, drawdowns, open positions and trade records. Its version/hash includes the entry and policy modules. The UI explicitly warns if a retained report belongs to an older rule version. Three chronological reporting windows remain descriptive, not unseen out-of-sample evidence. Current filters, ticker reconstruction, publication delay assumptions, fixed slippage and OHLC path ambiguity limit any inference.

## Verification and sources

The full local suite passed **166 TypeScript tests in 22 files**, **34 Python tests**, lint, typecheck and production build. New regression tests cover neutral taker-buy with a qualified breakout, daily risk above the old 8% cap with bounded account loss, high-score WAIT without an entry trigger, unsafe limits, true prior-bar breakout comparison, lower-volume pullbacks and stale structure events. Existing future-context, frozen original, cash, gap and paper-import tests remain passing.

An independent read-only review found no remaining causality, sizing or frozen-ledger blocker. It identified contradictory legacy wording for optional MACD/VWAP context; that wording was corrected.

The built application was also tested in a separate localhost:3001 browser origin, without changing the user's existing portfolio. INJ 1D displayed BUY, quality 97, 9/9 mandatory checks and 3/4 supporting checks. Taking the actual recommendation reserved 503.16805248 USDT for 59.38 units, preserved the original entry/SL/TP levels, and retained the journal after reload. Cancelling the unfilled test plan returned cash to 10,000 USDT, kept realized P/L at zero and retained the original recommendation and cancellation event in trade history. No simulated fill was invented from the higher live quote.

Implementation commit [`e375c88`](https://github.com/fareza777/website-intel-x/commit/e375c8881c7ad7f9fd887985dd6b5b7e2d683776) passed [GitHub Verify](https://github.com/fareza777/website-intel-x/actions/runs/38852977980) and reached READY on Vercel production deployment `dpl_32MiuKUi71RgwMkXtTYeh5rQ7aHb`. The [official publisher](https://github.com/fareza777/website-intel-x/actions/runs/38852988196) refreshed analytics, replay and real recommendations, writing data commit `6d094e1055be438a01d696c60cef3a789aeab190`. Its snapshot was generated at **2026-10-16T04:55:44.632Z**, with five daily BUY plans and all sixteen cx-spot-4 replay rows. The [live site](https://cryptointel-x-nu.vercel.app/) API reported fresh data and the browser showed INJ 1D quality 97, BUY, 9/9 mandatory checks and an enabled Take virtual trade button. Comparing all 31 prior public originals by ID and complete frozen setup found no missing or changed originals; the updated ledger contained 45 records.

- [Fidelity ATR](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr): volatility-adaptive stops and intraday/daily calculation concepts.
- [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI): persistent high RSI during strong trends; preferred ranges need context.
- [QuantConnect Donchian](https://www.quantconnect.com/docs/v2/writing-algorithms/indicators/supported-indicators/donchian-channel): trailing high/low channel calculation. These references do not validate the app's profitability or particular policy thresholds.
