# CryptoIntel X design

Build an institutional spot research terminal with real Binance public data only. Large readable type, charcoal surfaces, blue accents, accessible mobile layouts, no green theme. Frontend: Next.js/TypeScript/Tailwind/shadcn primitives and Lightweight Charts. No trading keys or transaction endpoints.

Closed 1H/4H/1D candles drive deterministic EMA/RSI/MACD/ATR, causal structure and volume analysis. Scan 30 liquid USDT spot pairs (configurable 20–50); reject weak or stale setups. Scores measure rule agreement, never win probability. Costs default to 10 bps fee and 5 bps slippage each side. Tick and lot filters constrain prices and sizes.

Separate scanning, immutable published recommendations, and candle-driven simulation. Enter only after publication; conservative stop-first resolution for ambiguous OHLC bars, gap-aware stop fills, no same-bar targets on a newly touched limit entry. Signals expire after 24h unfilled; time exit after 72h open. Never rewrite original setups. No fabricated history.

Use small JSON state on a dedicated GitHub market-data branch for free durable automation, immutable monthly original-signal archives, and local ignored data for development. Public Vercel reads published state; manual scans are explicitly previews unless a configured authenticated publisher persists them. Browser paper portfolio and journal persist locally, with JSON export/import; global signal autopsy remains on GitHub. Alert IDs are deterministic and deduplicated.

GitHub Actions scans every four hours (staggered minutes), serial concurrency, bounded requests/timeouts, no overlapping workers, no binary databases or large candle commits. Python analytical CLI downloads real data, runs cost-aware chronological walk-forward comparisons and optional audited open-source statistics; outputs compact report JSON. Mandatory functionality never requires an LLM. Optional Grok uses only frozen numbers of qualified signals.

Validation must exercise indicator conventions, prefix invariance, partial-candle filtering, fee-aware sizing, conservative outcomes, duplicate publication, unavailable markets, and backtest chronology. Run TypeScript/Python tests, lint, typecheck, production build, and desktop/mobile browser verification before GitHub push and Vercel deployment.
