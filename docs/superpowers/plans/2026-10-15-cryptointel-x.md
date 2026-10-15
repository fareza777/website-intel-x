# CryptoIntel X Implementation Plan

> For agentic workers: use the testing skill and parallel agents for independent domains, then review the complete integration.

**Goal:** A real-data automated crypto research terminal with deterministic plans and transparent performance tracking.
**Architecture:** Shared typed market contracts connect a server-side scanner, durable scheduled publication, and a chart-led Next.js interface. A separate Python process validates strategies against historical closed Binance candles.
**Tech Stack:** Next.js, TypeScript, Tailwind, shadcn primitives, Lightweight Charts, Python, Binance public API, GitHub Actions, Vercel.
**Spec:** docs/superpowers/specs/2026-10-15-cryptointel-x-design.md

## Global constraints
Real Binance spot data only; closed candles; no future data; immutable original signals; no real orders; fees and slippage on both sides; large legible type and charcoal/blue theme.

## Review focus
Exchange block/throttle returns an explicit unavailable state. Gaps and intrabar ambiguity are conservative. Empty history yields unavailable performance, never a fake zero win rate. Watchlist inputs are bounded and validated. Public manual requests cannot mutate global history or spend AI credits.

## Task 1: Scanner and causal analysis
Files: lib/market/*, tests/market*.test.ts. Contract: lib/types.ts MarketSnapshot and MarketSetup. Write and run failing tests for closed-candle filtering, known indicator values, prefix-invariant structure, rejection and net-cost risk. Implement bounded Binance retrieval and scanMarket({symbols?,limit?}). Validate with live market scan and tests.

## Task 2: Historical Python analytics
Files: analytics/*, tests/python/*, docs/open-source-audit.md. Contract: AnalyticsReport JSON from lib/types.ts. Research licenses and causal limitations from upstream. Write failing tests for cost-aware stop-first simulation and chronological splits. Implement live-only download, walk-forward comparisons and optional Ruptures/River/QuantStats adapters. Execute tests and an actual report.

## Task 3: Outcomes and publication
Files: lib/tracking.ts, lib/storage.ts, scripts/scan.ts, .github/workflows/*, tests/tracking.test.ts. Contract: StoredState. Test immutable publication, deduplication, post-publication fills, gap stops, expiration, and partial targets. Persist local state atomically and small state files on the separate market-data branch. CI verifies code and scans every hour.

## Task 4: Terminal and browser paper portfolio
Files: app/*, components/*, lib/paper.ts, tests/paper.test.ts. Show real scan, search/sort/watchlist, chart intervals/overlays, research panel, sizing, autopsy, liquidity and volume, report results, local paper portfolio/journal and alerts. Test sizing and portfolio cash conservation. Verify loading/error/empty states and mobile navigation.

## Task 5: Integration and delivery
Files: README.md, .env.example, vercel.json, docs/*.md. Run npm test, Python tests, npm run lint, npm run typecheck, npm run build, desktop/mobile QA. Review and repair correctness/security issues. Push to the supplied repository; trigger persisted scan and deploy the verified application to Vercel. Document any missing optional service configuration honestly.
