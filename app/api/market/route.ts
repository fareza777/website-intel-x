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
  return NextResponse.json({ snapshot, signals: state.signals, alerts: state.alerts, analytics: state.analytics, scannerValidation: state.scannerValidation ?? null, persistence, preview: !state.snapshot, stale: isStale(full.generatedAt) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
