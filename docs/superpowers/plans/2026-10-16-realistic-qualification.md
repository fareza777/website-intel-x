# Realistic timeframe qualification implementation plan

**Goal:** Allow useful, technically qualified spot entries without requiring every correlated indicator to pass, while retaining causal data, meaningful triggers and capital risk limits.

**Scope:** Revise the existing scanner and its explanations. Implement in this session; no new service or dependency. The user explicitly requested realistic qualification and authorized the adjustment.

**Root cause:** Daily INJ scored 97 on the real 2026-10-16 01:23 UTC scan, but daily ATR 9.29%, structural stop loss 19.87%, and 24-day taker-buy 49.76% failed fixed 6%/8%/52% gates. These percentages had been applied identically to intraday and daily analysis, and every supportive measurement was also a mandatory gate.

## Frozen v4 design, before performance evaluation

- Preserve the existing score weights and minimum BUY score 78; score remains agreement, not probability. Recognize confirmed pullbacks as price confirmation as well as breakouts/structure reclaims.
- Mandatory: valid/fresh closed data, liquid market, no bearish required context, non-extreme volatility/extension, valid costed levels, decision price above EMA50 with EMA50 above EMA200, score floor and one specific price trigger.
- Breakout/structure path: bullish latest closed candle, prior 20-bar high break or bullish structural confirmation on that decision candle, and relative volume >=1.0. Current-bar highs cannot enter the prior channel.
- Pullback path: the latest or preceding two candles touch/reclaim EMA21 within 0.25 ATR, followed by a bullish decision close above EMA21 and the previous close. No elevated breakout-volume requirement for a pullback; the existing liquidity floor remains.
- MACD, RSI's preferred 45–70 range, VWAP and taker-buy participation contribute quality and remain visible context. They are not independent vetoes. Existing RSI >78 and price >3 ATR above EMA21 still block overextension.
- Explicit horizon policies (application tolerances, not profitable optima): maximum ATR / costed position-stop loss are 4%/8% (15M), 6%/10% (1H), 10%/20% (4H), 12%/25% (1D). Do not tighten or move structural stops to fake compliance. Position sizing still limits account risk after fees and slippage.
- Version new originals as cx-spot-4. Preserve all v3 originals, fills, levels and journals unchanged. Labels distinguish mandatory checks from supporting context.
- Freeze these rules before replay. Compare v3 and v4 on the same real BTC/ETH/SOL/INJ history, costs, independent accounts and timing. INJ is included because it is the reported case, not because its historical return was selected. No parameter search or retrospective profit claim.

## Tasks

- [x] Write red tests for high-quality near-neutral taker-buy, a causal EMA pullback, missing triggers, daily stop sizing and unsafe caps. Implement entry detection and horizon risk policies.
- [x] Version metadata/schema compatibility, compulsory/context UI and Indonesian explanations/guide. Verify frozen legacy imports and account loss budgets.
- [x] Run a real current scan and matched v3/v4 replay; publish the current version's evidence with explicit limitations. Keep raw candles out of Git.
- [ ] Independent correctness review, TS/Python tests, lint/typecheck/build and browser checks; push and verify CI, Vercel and fresh official publication.

Local review, all calculation suites, production build and the isolated browser paper-trade flow have passed. Remote delivery verification remains pending at the implementation commit.

Primary references: Fidelity ATR and RSI guides describe volatility-adaptive stops and persistent overbought readings during trends; QuantConnect Donchian documentation describes trailing high/low channels. These support calculation concepts, not the profitability of these particular thresholds.
