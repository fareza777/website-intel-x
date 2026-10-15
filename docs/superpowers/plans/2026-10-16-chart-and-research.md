# Chart and Research Implementation Plan

> Implement natively in this session with an independent reviewer before delivery.

**Goal:** Configurable, readable charts and understandable, source-backed recommendation evidence.

**Architecture:** Pure tested chart calculations and preferences feed a Lightweight Charts adapter and settings UI. A guide/explanation module teaches the existing strategy. A separate replay runner reuses the production decision and fill functions and is published through existing analytics storage.

**Stack:** Existing Next.js/TypeScript/Lightweight Charts 5.2.1/Zod/GitHub Actions. No new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-chart-and-research-design.md`.

## Constraints and review focus

Real data only; closed candles; frozen originals; no real orders, leverage or mandatory AI. Large readable text; charcoal/blue/rose. Test settings with corrupt storage, hover on whitespace/first bars, refresh while zoomed, future historical candles, and account conservation with expired/open trades.

## Tasks

- [x] Test candle percentages, settings bounds, causal Bollinger/VWAP/Donchian/study calculations. Implement `lib/chart-studies.ts`.
- [x] Build `components/chart-settings.tsx` and upgrade `components/market-chart.tsx`: selectable panes and styles, persisted settings, crosshair inspector, range/zoom/expanded view and stale states. Remove obsolete outer chart controls from `components/terminal.tsx`.
- [x] Test deterministic plain-language risk explanation. Build `lib/research-explanation.ts`, upgrade the qualification panel and add `components/guide-view.tsx` with contextual navigation and source links.
- [x] Test replay chronology, publication delay, historical 24h inputs, account risk, gaps and statistics. Implement `lib/research/replay.ts`, `scripts/validate-scanner.ts`, report types/UI and daily workflow integration. Run real-data validation and preserve output through normal publication.
- [x] Request independent review; resolve findings. Run full TS/Python suites, lint/typecheck/build, real desktop/mobile browser checks, push and verify CI/Vercel/latest public data.

Core commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `analytics/.venv/Scripts/python.exe -B -m unittest discover -s tests/python`, `npx tsx scripts/validate-scanner.ts --days 90`. Source and report failures must remain explicit; do not add sample evidence.

Local verification: 157 TypeScript tests across 20 files, 34 Python tests, lint, typecheck and optimized Next.js build passed. Independent read-only review found and verified fixes for higher-horizon equity marks and manual-preview evidence retention. Real 90-day replay produced 12 pair/horizon rows and 19 completed trades, with insufficient evidence and mostly negative returns. Desktop hover, settings persistence, contextual guide and mobile containment were checked in the real browser. Remote CI, forced daily publisher, READY Vercel deployment and fresh published four-horizon data were verified; see docs/verification-2026-10-16.md.
