import { NextResponse } from "next/server";
import { readPublishedState } from "@/lib/storage";
import { cachedScan } from "@/lib/server-market";
import { isStale } from "@/lib/utils";
export const maxDuration = 60;
export async function GET() {
  const { state, persistence } = await readPublishedState();
  const snapshot = state.snapshot || await cachedScan();
  return NextResponse.json({ snapshot, signals: state.signals, alerts: state.alerts, analytics: state.analytics, persistence, preview: !state.snapshot, stale: isStale(snapshot.generatedAt) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
