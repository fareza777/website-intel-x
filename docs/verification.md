# Verification record

Verified on 2026-10-15 before initial publication.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 111 tests passed across 12 files.
- `npm run build`: passed; static terminal and five server routes compiled.
- Core Python suite: 33 tests completed, four optional adapters skipped in the system interpreter.
- Isolated optional Python environment: all 33 tests passed; dependency consistency checked.
- `npm audit --omit=dev`: zero production vulnerabilities. The development-only Next ESLint dependency chain reports an upstream unpatched braces advisory; arbitrary external glob expressions are not accepted by the application.

Actual Binance requests verified market scanning, one-letter symbols, closed candles, order book, and batched live quotes. The recent scan analyzed 29 of 30 requested markets; HYPE was explicitly withheld for insufficient EMA200 history. No substitute series or sample recommendation was used.

Browser checks used the real local server at desktop 1536×1000 and mobile 390×844. Verified navigation, chart intervals and real candlestick rendering, per-horizon score labels, conditional-plan rejection, filters/empty states, watchlist saving, volume depth, and overflow. A virtual starting balance of 10001 survived full reload through IndexedDB, then was restored to the default 10000 before handoff. No synthetic positions were added to the browser or public ledger.

Calculation regressions cover causal/prefix-invariant analysis, context cutoff for every horizon, exact price precision, costs and lot sizing, publication time after scan completion, conservative OHLC fills, gap stops, target milestones, horizon holding limits, immutable originals, conditional WAIT expiry/supersession, duplicate events, import cash conservation, invalid milestone rejection, concurrent journal preservation, and fresh-quote manual virtual exits.

Optional paid Grok requests and external alert webhooks require user-supplied credentials and destinations. Their validation/selection/deduplication paths are tested; no paid provider call or external alert was sent during verification. The terminal and scheduled scanner work without them.

The [production deployment](https://cryptointel-x-nu.vercel.app/) reached READY in Vercel's Singapore region. [GitHub verification](https://github.com/fareza777/website-intel-x/actions/runs/38741506962) and the first [market publisher run](https://github.com/fareza777/website-intel-x/actions/runs/38742303918) completed successfully. Production `/api/market` returned the durable GitHub state with all three research horizons, 29 analyzed markets, the original signal ledger and the real analytical report. Browser checks confirmed independent 1H/4H recommendations, real chart rendering and no console errors.

Freshness follow-up: 121 TypeScript tests passed across 14 files, with lint, typecheck and production build passing. Regression tests verify that a newer scheduled publication supersedes an old localhost seed, newer local publications survive, outages preserve existing data, quote subscriptions remain within 50 symbols, stale quotes are withheld and the next 30-second quote refresh receives a new exchange observation. Browser observation confirmed the price and observation timestamp changed without reloading. Bounded minute cache keys prevent an older raw-branch response from hiding a successful publication. Live quote checks and closed-candle polling run independently of immutable recommendation plans. The displayed next scan slot matches the actual UTC workflow schedule; GitHub runner start times can be delayed.
