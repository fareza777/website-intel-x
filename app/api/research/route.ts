import { NextResponse } from "next/server";
import { readPublishedState } from "@/lib/storage";
import { compactResponse } from "@/lib/payload";

export const maxDuration = 30;

/**
 * Research is deliberately split from /api/market. The signal ledger is large and
 * only the autopsy page needs it; strategy reports are similarly lazy. This keeps
 * the dashboard refresh small while preserving the complete immutable records.
 */
export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "history" && scope !== "strategy") {
    return NextResponse.json({ error: "Use scope=history or scope=strategy." }, { status: 400 });
  }

  const { state, persistence } = await readPublishedState();
  const payload = scope === "history"
    ? { signals: state.signals }
    : { analytics: state.analytics, scannerValidation: state.scannerValidation ?? null };

  return compactResponse({ ...payload, publishedAt: state.updatedAt, persistence }, "public, s-maxage=600, stale-while-revalidate=1800");
}
