# Terminal integrity and chart ruler implementation plan

**Goal:** Make live market displays coherent, default the full terminal to English, contain readable text on desktop/mobile, and add a real price measurement tool.

**Architecture:** Keep Next.js, the existing Binance public adapter and Lightweight Charts. Separate live ticker observations from frozen strategy inputs; share freshness validation and preserve original setups. Use a pointer-driven chart overlay with raw price/time coordinate conversions, without external dependencies or real orders.

**Authorized scope:** The user requested this audit and implementation directly. Retain the charcoal/blue/rose theme and large text; no trading policy or score changes.

## Findings before implementation

- Direct Binance and deployed quote API matched for BTC/ETH/SOL/INJ/ZEC. Radar changes/volume were from the older scan while prices were live, creating a misleading mixed-time display.
- Mixed Indonesian/English text exists in chart settings, methodology, explanations and Strategy Lab. Dates use mixed or implicit locales.
- Numerous fixed nowrap labels and narrow flex/grid values can overflow; review at desktop/tablet/390px mobile with real long values.
- A read-only audit identified a possible IndexedDB fallback rollback and incomplete public outcome-history detection; reproduce before changing either.

## Deliverables and checks

- [x] Add failing quote regressions for coherent 24h ticker metadata, actual observation time, malformed/stale data, per-symbol identity and bounded batches; implement in `lib/market/binance.ts`, `lib/live-market.ts`, types and quote route. Keep frozen scanner fields unchanged. Show fresh ticker change/volume in radar, with clear scan labels for research.
- [x] Translate every default UI/guide/explanation/settings/chart string into concise English. Preserve legacy original text/data and numerical meanings. Use English timestamp formatting with timezone context.
- [x] Add `lib/chart-measurement.ts` and regression cases for up/down/zero movement, reversed time, tiny prices and invalid inputs. Add chart overlay that supports drag and two clicks, raw-price percent calculation, candle count/time span, reset and Escape; restrict endpoints to the main price pane and retain coordinates through pan/zoom. A new asset/horizon clears the measure.
- [x] Fix confirmed storage/outcome bugs with red/green regressions. Review sizing estimate vs actual virtual cash and snapshot order-book semantics.
- [x] Repair common layout constraints, uniform typography, buttons and long numeric content without shrinking the text. Inspect every page at desktop and mobile, filters/settings, unavailable-data messages, charts/measurement and portfolio persistence. Record findings and evidence.
- [x] Independent review, full TS suite, available Python checks, lint/typecheck/build. See the terminal integrity audit for results and optional-package limits. Delivery verification after this source commit covers push, CI/Vercel and deployed quotes/ruler/pages; screenshots stay outside Git.

## Review focus

Fresh prices must never fall back to research closes. Missing quote fields are unavailable, not stale scan data labeled live. Invalid/old provider observation times must fail safely. Ruler calculations use raw prices even in log/percentage scales and ignore oscillator panes. Storage failures must not silently restore an older account. Missing candles must not invent fills or profits. No new strategy or backtest-performance claim follows from this UI/data audit.

Reference concepts: Binance Spot `ticker/24hr` full response provides last price and the same window's change/quote volume; Lightweight Charts coordinate-to-price and time/logical coordinate APIs support native chart measurements.
