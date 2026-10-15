# Verification record

Verified on 2026-10-15 before initial publication.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 111 tests passed across 12 files.
- `npm run build`: passed; static terminal and six server routes compiled.
- Core Python suite: 33 tests passed, four optional adapters skipped in the system interpreter.
- Isolated optional Python environment: all 33 tests passed; dependency consistency checked.
- `npm audit --omit=dev`: zero production vulnerabilities. The development-only Next ESLint dependency chain reports an upstream unpatched braces advisory; arbitrary external glob expressions are not accepted by the application.

Actual Binance requests verified market scanning, one-letter symbols, closed candles, order book, and batched live quotes. The recent scan analyzed 29 of 30 requested markets; HYPE was explicitly withheld for insufficient EMA200 history. No substitute series or sample recommendation was used.

Browser checks used the real local server at desktop 1536×1000 and mobile 390×844. Verified navigation, chart intervals and real candlestick rendering, per-horizon score labels, conditional-plan rejection, filters/empty states, watchlist saving, volume depth, and overflow. A virtual starting balance of 10001 survived full reload through IndexedDB, then was restored to the default 10000 before handoff. No synthetic positions were added to the browser or public ledger.

Calculation regressions cover causal/prefix-invariant analysis, context cutoff for every horizon, exact price precision, costs and lot sizing, publication time after scan completion, conservative OHLC fills, gap stops, target milestones, horizon holding limits, immutable originals, conditional WAIT expiry/supersession, duplicate events, import cash conservation, invalid milestone rejection, concurrent journal preservation, and fresh-quote manual virtual exits.

Optional paid Grok requests and external alert webhooks require user-supplied credentials and destinations. Their validation/selection/deduplication paths are tested; no paid provider call or external alert was sent during verification. The terminal and scheduled scanner work without them.
