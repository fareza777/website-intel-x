# Terminal integrity audit · 16 October 2026

This audit covers live market displays, all eleven terminal pages, chart measurement, local portfolio persistence and public outcome coverage. It does not change the cx-spot-4 qualification rules, original levels or historical performance.

## Confirmed issues and changes

- Radar prices matched Binance in the initial comparison, but the adjacent 24-hour change and volume came from the older research scan. The quote adapter now obtains price, change and USDT volume from the same full rolling ticker response. Cards, table sorting and volume totals use these observations. The exchange timestamp is displayed; missing or stale values remain unavailable. Requests are cached/coalesced and split into batches of at most twenty symbols.
- Default interface text, chart settings, guides, methodology and explanations now use English with explicit English date formatting. Frozen historical originals retain their original data. Prices retain instrument precision; account cash and P/L use cents. Non-finite values show unavailable, not invented numbers.
- Shared layout constraints contain long labels, numeric values and controls without reducing the base text size. Desktop and mobile page audits covered Overview, Opportunity Radar, Trade Workspace, Liquidity Radar, Volume Intelligence, Signal Autopsy, Strategy Lab, Paper Trading, Smart Alerts, Terminal Guide and Settings. Wide data tables scroll within their own container.
- Chart Studio now has **Measure** and **Clear** controls. Drag between two points or select them with two clicks. It reports signed percentage change, raw price difference and time/candle interval span. Measurements use native price coordinates in normal, logarithmic and percentage scales, remain anchored during pan/zoom and exclude oscillator panes. Escape clears the selection. Changing market or horizon resets it.
- IndexedDB and fallback copies are validated independently and restored by revision. A newer fallback survives a transient primary write failure. Cleanup preserves newer or invalid fallback bytes, and denied fallback access cannot turn a completed primary save into a failure. Exported portfolio format remains compatible.
- The trade workspace previews quantity, reserved cash and maximum simulated loss using the actual virtual account's remaining cash, lot size and risk budget. Its separate research-capital estimate no longer acts as the virtual-order sizing gate. User cancellation is labeled CANCELLED; original records remain intact.
- Corrupt local publisher state can recover from valid shared state without overwriting the corrupt bytes. Incomplete candle coverage is reported in publisher diagnostics instead of being presented as a completed outcome. No missing candles are filled with fabricated prices.
- Volume Intelligence distinguishes frozen candle-derived studies from a one-time order-book snapshot and displays the correct units. Sub-unit profile volumes, missing quotes and empty samples have explicit handling.

## Verification evidence

- Final local TypeScript suite: **199 tests across 26 files passed**. Regression coverage includes ticker identity/freshness/batching, raw-price measurements, small prices, storage revisions/failures, actual-account sizing and publisher history gaps.
- Lint, TypeScript typecheck and optimized Next.js build passed.
- The default local Python environment ran 34 tests: **30 passed and 4 optional-library checks skipped** because their packages are absent there. CI installs the pinned analytics dependencies and runs the optional checks as well.
- Desktop viewport 1280px and mobile viewport 390px: all eleven pages inspected; no document-width overflow or unintended text overflow was found in the checked states. Watchlist filtering with BTC/ETH/SOL returned those three markets. Manual preview scanning completed without captured browser errors.
- Local virtual simulation reserved $503.17 for 59.38 INJ with a $99.99 maximum modeled loss; the displayed preview and actual reservation matched. Reload preserved the record and journal. Cancelling the unfilled simulation restored virtual cash without invented P/L. The test used a separate localhost origin.
- Browser measurement tests covered dragging, two-click selection, clear/Escape, pan/zoom anchoring, mobile and all three price scales. For example, a raw range from 5.193567716 to 7.72632154 displayed +48.77%. These are cursor-selected chart levels, not trading returns.
- Direct provider/API comparison at 08:19 UTC used BTC/ETH/SOL/INJ/ZEC. Consecutive requests matched exactly for three markets; the largest intervening price movement was about 0.10% across the separately timed observations. Observation times are retained, so moving ticks are not described as simultaneous.

Delivery checks after this source commit include the GitHub verification workflow, a forced market/analytics publication, Vercel's deployed commit and the production quote/measurement UI. Runtime JSON and screenshots remain in ignored storage rather than the source branch.

## Practical limits

Quotes poll every thirty seconds while the page is visible; they are not a tick-by-tick websocket feed. Recommendations use closed candles and publish hourly on a best-effort GitHub schedule. A frozen setup price or chart close can legitimately differ from the latest quote. An unsupported or insufficiently mature market remains a partial-scan diagnostic.

The score measures technical rule agreement, not win probability. This audit establishes the checked calculations and flows, not future profitability or the absence of every possible defect. Portfolio fills remain conservative closed-candle simulations with fees and slippage. Browser-local records require export for backup.

Provider/API references: [Binance Spot market endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market), [Lightweight Charts series coordinate conversion](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi), [time-scale conversion](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi).
