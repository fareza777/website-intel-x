import { NextResponse } from "next/server";
import { z } from "zod";
import { cachedScan } from "@/lib/server-market";
import { symbolSchema } from "@/lib/validation";
import { isSameOriginRequest } from "@/lib/request-origin";
export const maxDuration = 60;
const schema = z.object({ symbols: z.array(symbolSchema).min(1).max(50).optional(), limit: z.number().int().min(20).max(50).default(50) });
let lastRequest = 0;
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-origin scan requests are not accepted." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 8000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const body = await request.text();
  if (body.length > 8000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let payload: unknown; try { payload = JSON.parse(body); } catch { payload = null; }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Use 1–50 USDT spot symbols or an automatic universe of 20–50 assets." }, { status: 400 });
  if (Date.now() - lastRequest < 30_000) return NextResponse.json({ error: "A scan was just requested. Please wait 30 seconds to respect exchange rate limits." }, { status: 429, headers: { "Retry-After": "30" } });
  lastRequest = Date.now();
  const snapshot = await cachedScan(parsed.data.symbols ? [...new Set(parsed.data.symbols)] : undefined, parsed.data.limit);
  return NextResponse.json({ snapshot, preview: true, message: "Live scan preview. Only the scheduled publisher adds immutable official signals." }, { status: snapshot.status === "unavailable" ? 503 : 200 });
}
