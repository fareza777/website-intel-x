import { NextResponse } from "next/server";
import { readPublishedState } from "@/lib/storage";
import { cachedScan } from "@/lib/server-market";
import { isStale } from "@/lib/utils";
export const maxDuration = 60;
export async function GET() {
  const { state, persistence } = await readPublishedState();
  const full = state.snapshot || await cachedScan();
  // `setups` duplicates the 1H horizon view; the client reads timeframes and only falls back to setups for old states.
  const snapshot = full.timeframes?.["1h"] ? { ...full, setups: [] } : full;
  // Historical signals and strategy reports are intentionally loaded by their pages.
  // Keeping them out of this frequently refreshed response prevents a multi-megabyte
  // research ledger from being transferred every time the terminal checks the market.
  return NextResponse.json({
    snapshot,
    alerts: state.alerts,
    publishedAt: state.updatedAt,
    persistence,
    preview: !state.snapshot,
    stale: isStale(full.generatedAt),
  }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
